import { NextRequest } from "next/server";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { getValidToken } from "@/lib/netsuite/token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_SYNC_SECRET = process.env.ADMIN_SYNC_SECRET!;
const ADMIN_SECRET_HEADER = "x-admin-secret";

type FulfillmentId = number;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const http = axios.create({ timeout: 60000 });

async function netsuiteQuery(q: string, headers: Record<string, string>) {
  let attempt = 0;
  const delays = [500, 1000, 2000, 4000, 8000];
  for (;;) {
    try {
      return await http.post(
        `${BASE_URL}/query/v1/suiteql`,
        { q },
        { headers }
      );
    } catch (err: any) {
      const status = err?.response?.status;
      const code =
        err?.response?.data?.["o:errorDetails"]?.[0]?.["o:errorCode"];
      if (status === 429 || code === "CONCURRENCY_LIMIT_EXCEEDED") {
        const d = delays[Math.min(attempt, delays.length - 1)];
        await new Promise((r) => setTimeout(r, d));
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

function inferCarrierFromNumber(num: string): string {
  const n = (num || "").replace(/\s+/g, "").toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return "ups";
  if (/^[A-Z]{2}\d{9}US$/.test(n)) return "usps";
  if (/^\d{20,22}$/.test(n)) {
    if (/^9\d{19,21}$/.test(n)) return "usps";
    return "fedex";
  }
  if (/^\d{12}$/.test(n) || /^\d{15}$/.test(n)) return "fedex";
  if (/^\d{10}$/.test(n) || /^JJD\d+$/i.test(n) || /^JVGL\d+$/i.test(n))
    return "dhl";
  if (/^C\d{12}$/i.test(n)) return "ontrac";
  return "";
}

function buildTrackingUrl(carrier: string, num: string): string {
  if (!num) return "";
  const n = encodeURIComponent(num);
  const c = (carrier || "").toLowerCase();
  if (c.includes("fedex"))
    return `https://www.fedex.com/fedextrack/?tracknumbers=${n}`;
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${n}`;
  if (c.includes("usps"))
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
  if (c.includes("dhl"))
    return `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${n}`;
  if (c.includes("ontrac"))
    return `https://www.ontrac.com/trackingres.asp?tracking_number=${n}`;
  return `https://www.google.com/search?q=${encodeURIComponent(
    num + " tracking"
  )}`;
}

function dedupeDetails(
  arr: { number: string; carrier: string; url: string }[]
) {
  const seen = new Set<string>();
  const out: typeof arr = [];
  for (const d of arr) {
    const key = `${d.number}::${d.carrier || "?"}::${d.url || "?"}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  if (
    !ADMIN_SYNC_SECRET ||
    req.headers.get(ADMIN_SECRET_HEADER) !== ADMIN_SYNC_SECRET
  ) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const lookbackDays = Number(
    req.nextUrl.searchParams.get("lookbackDays") ?? 90
  );
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const batchSize = Math.max(
    50,
    Math.min(500, Number(req.nextUrl.searchParams.get("batchSize") ?? 300))
  );
  const detailConcurrency = Math.max(
    1,
    Math.min(8, Number(req.nextUrl.searchParams.get("detailConcurrency") ?? 5))
  );

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: profileRows, error: profilesErr } = await supabase
    .from("profiles")
    .select("netsuite_customer_id");
  if (profilesErr) {
    return new Response(JSON.stringify({ error: "Failed to load profiles" }), {
      status: 500,
    });
  }
  const customerIds = Array.from(
    new Set(
      (profileRows || [])
        .map((r: any) => Number(r.netsuite_customer_id))
        .filter((n) => Number.isFinite(n))
    )
  ) as number[];
  if (!customerIds.length) {
    return new Response(
      JSON.stringify({
        scanned: 0,
        upserted: 0,
        message: "No customer IDs in profiles",
      }),
      { status: 200 }
    );
  }

  const { data: state } = await supabase
    .from("sync_state")
    .select("*")
    .eq("key", "fulfillments")
    .maybeSingle();
  const sinceIsoRaw: string =
    (state?.last_cursor as string | undefined) ??
    new Date(Date.now() - lookbackDays * 86400000).toISOString();
  const sinceIso = new Date(sinceIsoRaw).toISOString();

  const token = await getValidToken();
  const baseHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    Prefer: "transient",
  } as const;

  // 1) Find changed fulfillment IDs
  const idSet = new Set<number>();
  for (const entBatch of chunk<number>(customerIds, 900)) {
    const entList = entBatch.join(",");
    const idsQuery =
      fromParam && toParam
        ? `
        SELECT T.id AS fulfillmentId, T.trandate AS lastmodifieddate
        FROM transaction T
        WHERE T.type='ItemShip' AND T.entity IN (${entList})
          AND T.trandate >= TO_DATE('${fromParam}','YYYY-MM-DD')
          AND T.trandate <  TO_DATE('${toParam}','YYYY-MM-DD')
        ORDER BY T.trandate ASC
      `
        : `
        SELECT T.id AS fulfillmentId, T.lastmodifieddate
        FROM transaction T
        WHERE T.type='ItemShip' AND T.entity IN (${entList})
          AND T.lastmodifieddate > TO_TIMESTAMP_TZ('${sinceIso}','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
        ORDER BY T.lastmodifieddate ASC
      `;
    const idsResp = await netsuiteQuery(idsQuery, baseHeaders as any);
    for (const r of idsResp?.data?.items || []) {
      const id = Number(r.fulfillmentid);
      if (Number.isFinite(id)) idSet.add(id);
    }
  }

  const changedIds = Array.from(idSet) as number[];
  if (!changedIds.length) {
    if (!dry && !fromParam) {
      await supabase
        .from("sync_state")
        .upsert(
          {
            key: "fulfillments",
            last_success_at: new Date().toISOString(),
            last_cursor: new Date().toISOString(),
          },
          { onConflict: "key" }
        );
    }
    return new Response(
      JSON.stringify({ scanned: 0, upserted: 0, message: "No changes" }),
      { status: 200 }
    );
  }

  // 2) Process in batches like invoices
  let upsertedCount = 0;
  let lastCursor = sinceIso;

  for (const ids of chunk<FulfillmentId>(changedIds, batchSize)) {
    const idList = ids.join(",");

    // SuiteQL triplet
    const headersQ = `
      SELECT
        T.id AS fulfillmentId,
        T.tranid AS tranId,
        T.trandate AS trandate,
        T.entity AS customerId,
        BUILTIN.DF(T.status) AS status,
        T.lastmodifieddate AS lastmodifieddate
      FROM transaction T
      WHERE T.type='ItemShip' AND T.id IN (${idList})
    `;
    const linesQ = `
      SELECT
        TL.transaction AS fulfillmentId,
        TL.linesequencenumber AS lineNo,
        I.id AS itemId,
        I.itemid AS sku,
        I.displayname AS displayName,
        NVL(ABS(TL.quantity),0) AS quantity,
        TL.custcol_hpl_serialnumber AS serialnumber,
        TL.custcolns_comment AS linecomment
      FROM transactionline TL
      JOIN item I ON I.id = TL.item
      WHERE TL.transaction IN (${idList})
    `;
    const soLinkQ = `
      SELECT
        PTL.NextDoc AS fulfillmentId,
        PTL.PreviousDoc AS soId,
        S.tranid AS soTranId
      FROM PreviousTransactionLink PTL
      JOIN transaction S ON S.id = PTL.PreviousDoc
      WHERE PTL.NextDoc IN (${idList}) AND S.type='SalesOrd'
    `;

    const [h, l, s] = await Promise.all([
      netsuiteQuery(headersQ, baseHeaders as any),
      netsuiteQuery(linesQ, baseHeaders as any),
      netsuiteQuery(soLinkQ, baseHeaders as any),
    ]);

    // Map header + lastmodifieddate
    const headerMap = new Map<
      number,
      {
        tran_id: string | null;
        trandate: string | null;
        customer_id: number | null;
        status: string | null;
        lastmodified: string | null;
      }
    >();
    for (const row of h?.data?.items || []) {
      const idNum = Number(row.fulfillmentid);
      headerMap.set(idNum, {
        tran_id: row.tranid ?? null,
        trandate: row.trandate ?? null,
        customer_id:
          row.customerid != null
            ? Number(row.customerid)
            : Number(row.customerId ?? null),
        status: row.status ?? null,
        lastmodified: row.lastmodifieddate
          ? String(row.lastmodifieddate)
          : null,
      });
      if (row.lastmodifieddate) lastCursor = String(row.lastmodifieddate);
    }

    // Lines
    const linesById = new Map<
      number,
      Array<{
        line_no: number;
        item_id: number | null;
        item_sku: string | null;
        item_display_name: string | null;
        quantity: number;
        serial: string | null;
        comment: string | null;
      }>
    >();
    for (const r of l?.data?.items || []) {
      const fid = Number(r.fulfillmentid);
      if (!linesById.has(fid)) linesById.set(fid, []);
      linesById.get(fid)!.push({
        line_no: Number(r.lineno ?? r.linesequencenumber ?? 0),
        item_id: r.itemid != null ? Number(r.itemid) : null,
        item_sku: r.sku ?? null,
        item_display_name: (r.displayname as string | null) ?? r.sku ?? null,
        quantity: Number(r.quantity ?? 0),
        serial: (r.serialnumber as string | null) ?? null,
        comment: (r.linecomment as string | null) ?? null,
      });
    }

    // SO links
    const soById = new Map<
      number,
      { soId: number | null; soTranId: string | null }
    >();
    for (const r of s?.data?.items || []) {
      const fid = Number(r.fulfillmentid);
      const soId = r.soid != null ? Number(r.soid) : null;
      const soTranId = (r.sotranid as string | null) ?? null;
      soById.set(fid, { soId, soTranId });
    }

    // Pull existing rows once for this batch to decide who needs detail fetch
    const { data: existingRows } = await supabase
      .from("fulfillments")
      .select(
        "fulfillment_id, last_modified, ship_status, tracking, tracking_urls, tracking_details"
      )
      .in("fulfillment_id", ids);

    const existingMap = new Map<number, any>();
    for (const r of existingRows || []) existingMap.set(r.fulfillment_id, r);

    // Compute the small set that actually needs record/v1
    const detailIds: number[] = [];
    for (const id of ids) {
      const head = headerMap.get(id);
      const ex = existingMap.get(id);
      const changed =
        !ex ||
        !ex.last_modified ||
        (head?.lastmodified &&
          String(ex.last_modified) !== String(head.lastmodified));
      const missing =
        !ex ||
        !ex.ship_status ||
        !ex.tracking_details ||
        (Array.isArray(ex.tracking_details) &&
          ex.tracking_details.length === 0);
      if (changed || missing) detailIds.push(id);
    }

    // Fetch details only for those
    const detailHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    } as const;

    async function fetchDetail(
      id: number
    ): Promise<{
      shipStatus: string;
      trackingDetails: { number: string; carrier: string; url: string }[];
    }> {
      let attempt = 0;
      const delays = [0, 500, 1000, 2000, 4000];
      for (;;) {
        try {
          const resp = await http.get(
            `${BASE_URL}/record/v1/itemFulfillment/${id}?expandSubResources=true`,
            { headers: detailHeaders }
          );
          const rec = resp.data || {};
          const shipStatus =
            rec.shipStatus?.refName ||
            rec.shipstatus?.refName ||
            rec.shipStatus?.text ||
            rec.shipstatus?.text ||
            "";
          const packagesRaw =
            rec.packageList?.packages ?? rec.packageList ?? rec.packages ?? [];
          const pkgs = Array.isArray(packagesRaw)
            ? packagesRaw
            : [packagesRaw].filter(Boolean);
          const nums: string[] = [];
          for (const pkg of pkgs) {
            const num =
              pkg?.packageTrackingNumber ||
              pkg?.trackingNumber ||
              pkg?.packageTrackingNo ||
              "";
            if (num) nums.push(String(num));
          }
          if (!nums.length) {
            const out = new Set<string>();
            (function walk(o: any) {
              if (o && typeof o === "object") {
                for (const k in o) {
                  const v = o[k];
                  if (
                    k.toLowerCase().includes("tracking") &&
                    typeof v === "string" &&
                    v.trim()
                  )
                    out.add(v.trim());
                  else if (typeof v === "object") walk(v);
                }
              }
            })(rec);
            nums.push(...Array.from(out));
          }
          let details = nums.map((num) => {
            const carrier = inferCarrierFromNumber(num);
            return {
              number: num,
              carrier,
              url: buildTrackingUrl(carrier, num),
            };
          });
          details = dedupeDetails(details);
          return { shipStatus, trackingDetails: details };
        } catch (e: any) {
          const status = e?.response?.status;
          const code =
            e?.response?.data?.["o:errorDetails"]?.[0]?.["o:errorCode"];
          if (
            status === 429 ||
            code === "CONCURRENCY_LIMIT_EXCEEDED" ||
            (status >= 500 && status < 600)
          ) {
            const d = delays[Math.min(attempt, delays.length - 1)];
            await new Promise((r) => setTimeout(r, d));
            attempt++;
            continue;
          }
          return { shipStatus: "", trackingDetails: [] };
        }
      }
    }

    const detailMap = new Map<
      number,
      {
        shipStatus: string;
        trackingDetails: { number: string; carrier: string; url: string }[];
      }
    >();
    for (const group of chunk(detailIds, detailConcurrency)) {
      const res = await Promise.all(group.map((id) => fetchDetail(id)));
      group.forEach((id, i) => detailMap.set(id, res[i]));
    }

    // Build rows
    const fulfillmentsRows: Array<any> = [];
    const linesRows: Array<any> = [];

    for (const id of ids) {
      const head = headerMap.get(id);
      if (!head) continue;
      const so = soById.get(id) ?? { soId: null, soTranId: null };

      // gather line arrays (serials/comments aggregated by line_no)
      const grouped = new Map<
        number,
        {
          item_id: number | null;
          item_sku: string | null;
          item_display_name: string | null;
          quantity: number;
          serials: Set<string>;
          comments: Set<string>;
        }
      >();
      for (const ln of linesById.get(id) || []) {
        if (!grouped.has(ln.line_no)) {
          grouped.set(ln.line_no, {
            item_id: ln.item_id,
            item_sku: ln.item_sku,
            item_display_name: ln.item_display_name,
            quantity: Math.abs(Number(ln.quantity || 0)),
            serials: new Set<string>(),
            comments: new Set<string>(),
          });
        }
        const g = grouped.get(ln.line_no)!;
        if (ln.serial) g.serials.add(String(ln.serial));
        if (ln.comment) g.comments.add(String(ln.comment));
      }
      for (const [line_no, g] of grouped.entries()) {
        linesRows.push({
          fulfillment_id: id,
          line_no,
          item_id: g.item_id,
          item_sku: g.item_sku,
          item_display_name: g.item_display_name,
          quantity: g.quantity,
          serial_numbers: Array.from(g.serials),
          comments: Array.from(g.comments),
        });
      }

      // details: prefer fresh from detailMap; else reuse existing
      const ex = existingMap.get(id);
      const det = detailMap.get(id) || {
        shipStatus: ex?.ship_status || null,
        trackingDetails: ex?.tracking_details || [],
      };

      fulfillmentsRows.push({
        fulfillment_id: id,
        tran_id: head.tran_id,
        trandate: head.trandate,
        customer_id: head.customer_id ?? null,
        status: head.status ?? null,
        created_from_so_id: so.soId,
        created_from_so_tranid: so.soTranId,
        ship_status: det.shipStatus || null,
        tracking:
          (det.trackingDetails || []).map((p: any) => p.number).join(", ") ||
          null,
        tracking_urls:
          (det.trackingDetails || []).map((p: any) => p.url) || null,
        tracking_details: det.trackingDetails || null,
        last_modified: head.lastmodified
          ? new Date(head.lastmodified).toISOString()
          : null,
        synced_at: new Date().toISOString(),
      });
    }

    if (!dry) {
      if (fulfillmentsRows.length) {
        const { error: e1 } = await supabase
          .from("fulfillments")
          .upsert(fulfillmentsRows as any, { onConflict: "fulfillment_id" });
        if (e1) throw e1;
      }
      await supabase
        .from("fulfillment_lines")
        .delete()
        .in("fulfillment_id", ids);
      if (linesRows.length) {
        const { error: e2 } = await supabase
          .from("fulfillment_lines")
          .upsert(linesRows as any, { onConflict: "fulfillment_id,line_no" });
        if (e2) throw e2;
      }
    }

    upsertedCount += fulfillmentsRows.length;
  }

  if (!dry && !fromParam) {
    await supabase
      .from("sync_state")
      .upsert(
        {
          key: "fulfillments",
          last_success_at: new Date().toISOString(),
          last_cursor: lastCursor,
        },
        { onConflict: "key" }
      );
  }

  return new Response(
    JSON.stringify({
      scanned: changedIds.length,
      upserted: upsertedCount,
      lastCursor,
    }),
    { status: 200 }
  );
}
