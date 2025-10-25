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

const http = axios.create({ timeout: 60000 });

let THROTTLE_429 = 0;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function netsuiteQuery(
  q: string,
  headers: Record<string, string>,
  tag?: string
) {
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
        THROTTLE_429++;
        const d = delays[Math.min(attempt, delays.length - 1)];
        await new Promise((r) => setTimeout(r, d));
        attempt++;
        continue;
      }
      const e = new Error("SuiteQL " + (tag || "") + " failed");
      (e as any).details = {
        tag,
        status: err?.response?.status,
        code,
        details:
          err?.response?.data?.["o:errorDetails"]?.[0]?.detail ||
          err?.response?.data,
        q,
      };
      throw e;
    }
  }
}

async function suiteqlKeysetIdsForEntities(
  headers: Record<string, string>,
  entListCsv: string,
  dateFilterSql: string | "",
  pageSize = 1000
) {
  const out: number[] = [];
  let lastDate: string | null = null;
  let lastId: number | null = null;

  for (;;) {
    const whereAfter = lastDate
      ? `AND (T.trandate < TO_DATE('${lastDate}','YYYY-MM-DD')
             OR (T.trandate = TO_DATE('${lastDate}','YYYY-MM-DD') AND T.id < ${lastId}))`
      : "";

    const q = `
      SELECT
        T.id AS fulfillmentId,
        TO_CHAR(T.trandate,'YYYY-MM-DD') AS trandate
      FROM transaction T
      WHERE T.type = 'ItemShip'
        AND T.entity IN (${entListCsv})
        ${dateFilterSql}
        ${whereAfter}
      ORDER BY T.trandate DESC, T.id DESC
      FETCH NEXT ${pageSize} ROWS ONLY
    `;

    const r = await netsuiteQuery(q, headers, "forceAllIdsKeyset");
    const items = r?.data?.items || [];

    for (const row of items) {
      const id = Number(row.fulfillmentid);
      if (Number.isFinite(id)) out.push(id);
    }

    if (items.length < pageSize) break;

    const tail = items[items.length - 1];
    lastDate = String(tail.trandate);
    lastId = Number(tail.fulfillmentid);

    await new Promise((res) => setTimeout(res, 40));
  }

  return out;
}

async function suiteqlKeysetIdsAll(
  headers: Record<string, string>,
  dateFilterSql: string | "",
  pageSize = 1000
) {
  const out: number[] = [];
  let lastDate: string | null = null;
  let lastId: number | null = null;

  for (;;) {
    const whereAfter = lastDate
      ? `AND (T.trandate < TO_DATE('${lastDate}','YYYY-MM-DD')
             OR (T.trandate = TO_DATE('${lastDate}','YYYY-MM-DD') AND T.id < ${lastId}))`
      : "";

    const q = `
      SELECT
        T.id AS fulfillmentId,
        TO_CHAR(T.trandate,'YYYY-MM-DD') AS trandate
      FROM transaction T
      WHERE T.type = 'ItemShip'
        ${dateFilterSql}
        ${whereAfter}
      ORDER BY T.trandate DESC, T.id DESC
      FETCH NEXT ${pageSize} ROWS ONLY
    `;

    const r = await netsuiteQuery(q, headers, "forceAllIdsKeysetAll");
    const items = r?.data?.items || [];

    for (const row of items) {
      const id = Number(row.fulfillmentid);
      if (Number.isFinite(id)) out.push(id);
    }

    if (items.length < pageSize) break;

    const tail = items[items.length - 1];
    lastDate = String(tail.trandate);
    lastId = Number(tail.fulfillmentid);

    await new Promise((res) => setTimeout(res, 40));
  }

  return out;
}

async function reconcileDeletedFulfillments(
  supabase: any,
  headers: Record<string, string>,
  customerIds: number[],
  dry: boolean
) {
  if (!customerIds.length) return { checked: 0, softDeleted: 0 };

  const pageSize = 1000;
  let from = 0;
  const localIds: number[] = [];
  for (;;) {
    const { data, error } = await supabase
      .from("fulfillments")
      .select("fulfillment_id")
      .in("customer_id", customerIds)
      .is("ns_deleted_at", null)
      .order("fulfillment_id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data || [])
      .map((r: any) => Number(r.fulfillment_id))
      .filter(Number.isFinite);
    if (!batch.length) break;
    localIds.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  if (!localIds.length) return { checked: 0, softDeleted: 0 };

  const missing: number[] = [];
  const cancelled: number[] = [];
  for (const batch of chunk<number>(localIds, 900)) {
    const idList = batch.join(",");
    const presentQ = `
      SELECT T.id AS fulfillmentId
      FROM transaction T
      WHERE T.type='ItemShip' AND T.id IN (${idList})
    `;
    const r1 = await netsuiteQuery(presentQ, headers, "presentIF");
    const present = new Set<number>(
      (r1?.data?.items || []).map((x: any) => Number(x.fulfillmentid))
    );
    for (const id of batch) if (!present.has(id)) missing.push(id);

    if (present.size) {
      const cancelledQ = `
        SELECT T.id AS fulfillmentId
        FROM transaction T
        WHERE T.type='ItemShip'
          AND T.id IN (${idList})
          AND (
            LOWER(BUILTIN.DF(T.status)) LIKE '%cancel%'
            OR LOWER(BUILTIN.DF(T.status)) LIKE '%void%'
          )
      `;
      const r2 = await netsuiteQuery(cancelledQ, headers, "cancelledIF");
      for (const row of r2?.data?.items || []) {
        const id = Number(row.fulfillmentid);
        if (Number.isFinite(id)) cancelled.push(id);
      }
    }

    await new Promise((r) => setTimeout(r, 120));
  }

  const toTombstone = Array.from(new Set([...missing, ...cancelled]));
  if (!dry && toTombstone.length) {
    const nowIso = new Date().toISOString();
    for (const ids of chunk<number>(toTombstone, 1000)) {
      await supabase
        .from("fulfillments")
        .update({ ns_deleted_at: nowIso })
        .in("fulfillment_id", ids);
    }
  }

  return { checked: localIds.length, softDeleted: toTombstone.length };
}

async function reconcileDeletedFulfillmentsAll(
  supabase: any,
  headers: Record<string, string>,
  dry: boolean
) {
  const pageSize = 1000;
  let from = 0;
  const localIds: number[] = [];
  for (;;) {
    const { data, error } = await supabase
      .from("fulfillments")
      .select("fulfillment_id")
      .is("ns_deleted_at", null)
      .order("fulfillment_id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data || [])
      .map((r: any) => Number(r.fulfillment_id))
      .filter(Number.isFinite);
    if (!batch.length) break;
    localIds.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  if (!localIds.length) return { checked: 0, softDeleted: 0 };

  const missing: number[] = [];
  const cancelled: number[] = [];
  for (const batch of chunk<number>(localIds, 900)) {
    const idList = batch.join(",");
    const presentQ = `
      SELECT T.id AS fulfillmentId
      FROM transaction T
      WHERE T.type='ItemShip' AND T.id IN (${idList})
    `;
    const r1 = await netsuiteQuery(presentQ, headers, "presentIFAll");
    const present = new Set<number>(
      (r1?.data?.items || []).map((x: any) => Number(x.fulfillmentid))
    );
    for (const id of batch) if (!present.has(id)) missing.push(id);

    if (present.size) {
      const cancelledQ = `
        SELECT T.id AS fulfillmentId
        FROM transaction T
        WHERE T.type='ItemShip'
          AND T.id IN (${idList})
          AND (
            LOWER(BUILTIN.DF(T.status)) LIKE '%cancel%'
            OR LOWER(BUILTIN.DF(T.status)) LIKE '%void%'
          )
      `;
      const r2 = await netsuiteQuery(cancelledQ, headers, "cancelledIFAll");
      for (const row of r2?.data?.items || []) {
        const id = Number(row.fulfillmentid);
        if (Number.isFinite(id)) cancelled.push(id);
      }
    }

    await new Promise((r) => setTimeout(r, 120));
  }

  const toTombstone = Array.from(new Set([...missing, ...cancelled]));
  if (!dry && toTombstone.length) {
    const nowIso = new Date().toISOString();
    for (const ids of chunk<number>(toTombstone, 1000)) {
      await supabase
        .from("fulfillments")
        .update({ ns_deleted_at: nowIso })
        .in("fulfillment_id", ids);
    }
  }

  return { checked: localIds.length, softDeleted: toTombstone.length };
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

function extractIFLines(rec: any) {
  type Line = {
    line_id: number | null;
    line_key: string | null;
    line_no: number;
    item_id: number | null;
    item_sku: string | null;
    item_display_name: string | null;
    quantity: number;
    serial_numbers: string[] | null;
    comments: string[] | null;
  };

  const firstPath =
    (Array.isArray(rec?.item?.items) && rec.item.items) ||
    (Array.isArray(rec?.itemList?.items) && rec.itemList.items) ||
    (Array.isArray(rec?.item) && rec.item) ||
    null;

  const rows: any[] = Array.isArray(firstPath) ? firstPath : [];
  const out: Line[] = [];

  for (const row of rows) {
    const lineRaw = row?.line;
    const lineKeyStr = lineRaw != null ? String(lineRaw) : null;
    const lineNum = lineRaw != null ? Number(lineRaw) : NaN;
    const lineId =
      Number.isFinite(lineNum) && !Number.isNaN(lineNum) ? lineNum : null;

    if (lineId == null) continue;

    const itemObj = row.item ?? row.itemRef ?? {};
    const itemId = Number(itemObj.id ?? itemObj.internalId ?? NaN);

    let itemSku: string | null = null;
    const skuCandidate =
      itemObj?.refName ?? itemObj?.name ?? itemObj?.text ?? null;
    if (skuCandidate != null) {
      itemSku = String(skuCandidate);
    } else if (row?.itemid != null) {
      const s = String(row.itemid).trim();
      if (/\D/.test(s)) itemSku = s;
    }

    const disp =
      row.description ?? itemObj.displayName ?? itemObj.refName ?? null;
    const qty = Math.abs(Number(row.quantity ?? 0));

    const serials: string[] = [];
    const ia =
      row.inventoryassignment ||
      row.inventoryAssignment ||
      row.inventoryDetail ||
      null;
    if (ia && typeof ia === "object") {
      const assignments = ia.assignments || ia.assignment || ia.details || [];
      const arr = Array.isArray(assignments) ? assignments : [assignments];
      for (const a of arr) {
        const sn =
          a?.issueinventorynumber?.text ??
          a?.inventorynumber?.text ??
          a?.serialnumber ??
          a?.lotnumber ??
          null;
        if (sn) serials.push(String(sn));
      }
    }

    const commentVal = row.custcolns_comment ?? row.comments ?? null;
    const comments = commentVal != null ? [String(commentVal)] : null;

    out.push({
      line_id: lineId,
      line_key: lineKeyStr,
      line_no: lineId,
      item_id: Number.isFinite(itemId) ? itemId : null,
      item_sku: itemSku,
      item_display_name: disp ? String(disp) : null,
      quantity: qty,
      serial_numbers: serials.length ? Array.from(new Set(serials)) : null,
      comments,
    });
  }

  return out;
}

export async function POST(req: NextRequest) {
  THROTTLE_429 = 0;

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
  const forceAll = req.nextUrl.searchParams.get("forceAll") === "1";
  const forceSince = req.nextUrl.searchParams.get("forceSince");
  const scopeAll = req.nextUrl.searchParams.get("scope") === "all";
  const idsParam = req.nextUrl.searchParams.get("ids");
  const batchSize = Math.max(
    50,
    Math.min(500, Number(req.nextUrl.searchParams.get("batchSize") ?? 300))
  );
  const detailConcurrency = Math.max(
    1,
    Math.min(10, Number(req.nextUrl.searchParams.get("detailConcurrency") ?? 5))
  );

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  let customerIds: number[] = [];
  let customerSet = new Set<number>();

  if (!scopeAll) {
    const { data: profileRows, error: profilesErr } = await supabase
      .from("profiles")
      .select("netsuite_customer_id");
    if (profilesErr) {
      return new Response(
        JSON.stringify({ error: "Failed to load profiles" }),
        {
          status: 500,
        }
      );
    }
    customerIds = Array.from(
      new Set(
        (profileRows || [])
          .map((r: any) => Number(r.netsuite_customer_id))
          .filter(Number.isFinite)
      )
    ) as number[];
    customerSet = new Set<number>(customerIds);

    if (!customerIds.length && !idsParam) {
      return new Response(
        JSON.stringify({
          scanned: 0,
          upserted: 0,
          lastCursor: null,
          foundModified: 0,
          foundCreatedToday: 0,
          foundFallbackToday: 0,
          checked: 0,
          softDeleted: 0,
          throttle429: THROTTLE_429,
          message: "No customer IDs in profiles",
        }),
        { status: 200 }
      );
    }
  }

  const { data: state } = await supabase
    .from("sync_state")
    .select("*")
    .eq("key", "fulfillments")
    .maybeSingle();
  const overlapMs = 10 * 60 * 1000;
  const baseSince =
    (state?.last_cursor as string | undefined) ??
    new Date(Date.now() - lookbackDays * 86400000).toISOString();
  const sinceIso = new Date(
    new Date(baseSince).getTime() - overlapMs
  ).toISOString();
  const sinceDate = sinceIso.slice(0, 10);

  const token = await getValidToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    Prefer: "transient, maxpagesize=1000",
  } as Record<string, string>;

  const idSet = new Set<number>();
  let foundModified = 0;
  let foundCreatedToday = 0;
  let foundFallbackToday = 0;

  if (idsParam) {
    idsParam
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .forEach((n) => idSet.add(n));
  } else if (forceAll) {
    if (scopeAll) {
      const dateFilter = forceSince
        ? `AND T.trandate >= TO_DATE('${forceSince}','YYYY-MM-DD')`
        : "";
      const ids = await suiteqlKeysetIdsAll(headers, dateFilter, 1000);
      for (const id of ids) idSet.add(id);
    } else {
      for (const entBatch of chunk<number>(customerIds, 900)) {
        const entList = entBatch.join(",");
        const dateFilter = forceSince
          ? `AND T.trandate >= TO_DATE('${forceSince}','YYYY-MM-DD')`
          : "";
        const ids = await suiteqlKeysetIdsForEntities(
          headers,
          entList,
          dateFilter,
          1000
        );
        for (const id of ids) idSet.add(id);
        await new Promise((r) => setTimeout(r, 60));
      }
    }
  } else {
    if (scopeAll) {
      const idsModQ = `
        SELECT
          T.id AS fulfillmentId,
          TO_CHAR(T.lastmodifieddate,'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS lmIso
        FROM transaction T
        WHERE T.type = 'ItemShip'
          AND T.lastmodifieddate >= TO_TIMESTAMP_TZ('${sinceIso}','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
        ORDER BY T.lastmodifieddate ASC
      `;
      const r1 = await netsuiteQuery(idsModQ, headers, "idsModifiedAll");
      for (const row of r1?.data?.items || []) {
        const id = Number(row.fulfillmentid);
        if (Number.isFinite(id)) idSet.add(id);
        foundModified++;
      }
      await new Promise((r) => setTimeout(r, 120));

      const idsCreatedTodayQ = `
        SELECT T.id AS fulfillmentId
        FROM transaction T
        WHERE T.type = 'ItemShip'
          AND T.trandate >= TO_DATE('${sinceDate}','YYYY-MM-DD')
        ORDER BY T.trandate ASC
      `;
      const r2 = await netsuiteQuery(
        idsCreatedTodayQ,
        headers,
        "idsCreatedAll"
      );
      for (const row of r2?.data?.items || []) {
        const id = Number(row.fulfillmentid);
        if (Number.isFinite(id)) idSet.add(id);
        foundCreatedToday++;
      }
      await new Promise((r) => setTimeout(r, 120));

      const fbQ = `
        SELECT T.id AS fulfillmentId
        FROM transaction T
        WHERE T.type = 'ItemShip'
          AND T.trandate >= TO_DATE('${sinceDate}','YYYY-MM-DD')
      `;
      const fb = await netsuiteQuery(fbQ, headers, "fallbackIdsAll");
      for (const row of fb?.data?.items || []) {
        const id = Number(row.fulfillmentid);
        if (Number.isFinite(id)) {
          idSet.add(id);
          foundFallbackToday++;
        }
      }
    } else {
      for (const entBatch of chunk<number>(customerIds, 900)) {
        const entList = entBatch.join(",");
        const idsModQ = `
          SELECT
            T.id AS fulfillmentId,
            TO_CHAR(T.lastmodifieddate,'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS lmIso
          FROM transaction T
          WHERE T.type = 'ItemShip'
            AND T.entity IN (${entList})
            AND T.lastmodifieddate >= TO_TIMESTAMP_TZ('${sinceIso}','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
          ORDER BY T.lastmodifieddate ASC
        `;
        const r1 = await netsuiteQuery(idsModQ, headers, "idsModified");
        for (const row of r1?.data?.items || []) {
          const id = Number(row.fulfillmentid);
          if (Number.isFinite(id)) idSet.add(id);
          foundModified++;
        }
        await new Promise((r) => setTimeout(r, 120));

        const idsCreatedTodayQ = `
          SELECT T.id AS fulfillmentId, T.entity AS customerId
          FROM transaction T
          WHERE T.type = 'ItemShip'
            AND T.entity IN (${entList})
            AND T.trandate >= TO_DATE('${sinceDate}','YYYY-MM-DD')
          ORDER BY T.trandate ASC
        `;
        const r2 = await netsuiteQuery(idsCreatedTodayQ, headers, "idsCreated");
        for (const row of r2?.data?.items || []) {
          const id = Number(row.fulfillmentid);
          if (Number.isFinite(id)) idSet.add(id);
          foundCreatedToday++;
        }
        await new Promise((r) => setTimeout(r, 120));
      }

      const fallbackQ = `
        SELECT T.id AS fulfillmentId, T.entity AS customerId
        FROM transaction T
        WHERE T.type = 'ItemShip'
          AND T.trandate >= TO_DATE('${sinceDate}','YYYY-MM-DD')
      `;
      const fb = await netsuiteQuery(fallbackQ, headers, "fallbackIds");
      for (const row of fb?.data?.items || []) {
        const id = Number(row.fulfillmentid);
        const cid = Number(row.customerid);
        if (Number.isFinite(id) && customerSet.has(cid)) {
          idSet.add(id);
          foundFallbackToday++;
        }
      }
    }
  }

  const changedIds = Array.from(idSet) as number[];
  if (!changedIds.length) {
    const { checked, softDeleted } = scopeAll
      ? await reconcileDeletedFulfillmentsAll(supabase, headers, dry)
      : await reconcileDeletedFulfillments(
          supabase,
          headers,
          Array.from(customerSet),
          dry
        );

    const nextCursorQ = `
      SELECT TO_CHAR(MAX(T.lastmodifieddate),'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS maxIso
      FROM transaction T
      WHERE T.type = 'ItemShip'
        AND T.lastmodifieddate >= TO_TIMESTAMP_TZ('${sinceIso}','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
    `;
    const mx = await netsuiteQuery(nextCursorQ, headers, "nextCursor");
    const maxIso = mx?.data?.items?.[0]?.maxiso || sinceIso;
    if (!dry) {
      await supabase.from("sync_state").upsert(
        {
          key: "fulfillments",
          last_success_at: new Date().toISOString(),
          last_cursor: maxIso,
        },
        { onConflict: "key" }
      );
    }
    return new Response(
      JSON.stringify({
        scanned: 0,
        upserted: 0,
        lastCursor: maxIso,
        foundModified,
        foundCreatedToday,
        foundFallbackToday,
        checked,
        softDeleted,
        throttle429: THROTTLE_429,
      }),
      { status: 200 }
    );
  }

  let upsertedCount = 0;
  let lastCursor = sinceIso;

  for (const ids of chunk<FulfillmentId>(changedIds, batchSize)) {
    const idList = ids.join(",");

    const headersQ = `
      SELECT
        T.id AS fulfillmentId,
        T.tranid AS tranId,
        T.trandate AS trandate,
        T.entity AS customerId,
        BUILTIN.DF(T.status) AS status,
        TO_CHAR(T.lastmodifieddate,'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS lastmodifieddate
      FROM transaction T
      WHERE T.type = 'ItemShip' AND T.id IN (${idList})
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

    const [h, s] = await Promise.all([
      netsuiteQuery(headersQ, headers, "headersQ"),
      netsuiteQuery(soLinkQ, headers, "soLinkQ"),
    ]);

    const headerMap = new Map<number, any>();
    for (const row of h?.data?.items || []) {
      const idNum = Number(row.fulfillmentid) as FulfillmentId;
      headerMap.set(idNum, {
        fulfillment_id: idNum,
        tran_id: row.tranid ?? null,
        trandate: row.trandate ?? null,
        customer_id: row.customerid != null ? Number(row.customerid) : null,
        status: row.status ?? null,
      });
      if (row.lastmodifieddate) lastCursor = String(row.lastmodifieddate);
    }

    const soById = new Map<
      FulfillmentId,
      { soId: number | null; soTranId: string | null }
    >();
    for (const r of s?.data?.items || []) {
      const fid = Number(r.fulfillmentid) as FulfillmentId;
      const soId = r.soid != null ? Number(r.soid) : null;
      const soTranId = (r.sotranid as string | null) ?? null;
      soById.set(fid, { soId, soTranId });
    }

    const detailHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      Prefer: "transient",
    } as const;

    async function fetchDetail(id: number): Promise<{
      shipStatus: string;
      trackingDetails: { number: string; carrier: string; url: string }[];
      lines: ReturnType<typeof extractIFLines>;
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
          const numbers: string[] = [];
          for (const pkg of pkgs) {
            const num =
              pkg?.packageTrackingNumber ||
              pkg?.trackingNumber ||
              pkg?.packageTrackingNo ||
              "";
            if (num) numbers.push(String(num));
          }
          if (!numbers.length) {
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
            numbers.push(...Array.from(out));
          }
          let details = numbers.map((num) => {
            const carrier = inferCarrierFromNumber(num);
            return {
              number: num,
              carrier,
              url: buildTrackingUrl(carrier, num),
            };
          });
          details = dedupeDetails(details);

          const lines = extractIFLines(rec);
          return { shipStatus, trackingDetails: details, lines };
        } catch (e: any) {
          const status = e?.response?.status;
          const code =
            e?.response?.data?.["o:errorDetails"]?.[0]?.["o:errorCode"];
          if (
            status === 429 ||
            code === "CONCURRENCY_LIMIT_EXCEEDED" ||
            (status >= 500 && status < 600)
          ) {
            THROTTLE_429++;
            const d = delays[Math.min(attempt, delays.length - 1)];
            await new Promise((r) => setTimeout(r, d));
            attempt++;
            continue;
          }
          return { shipStatus: "", trackingDetails: [], lines: [] };
        }
      }
    }

    const detailMap = new Map<
      number,
      {
        shipStatus: string;
        trackingDetails: { number: string; carrier: string; url: string }[];
        lines: ReturnType<typeof extractIFLines>;
      }
    >();

    for (const group of chunk(ids, detailConcurrency)) {
      const res = await Promise.all(group.map((id) => fetchDetail(id)));
      group.forEach((id, i) => detailMap.set(id, res[i]));
    }

    const fulfillmentsRows: Array<{
      fulfillment_id: number;
      tran_id: string | null;
      trandate: string | null;
      customer_id: number | null;
      ship_status: string | null;
      status: string | null;
      created_from_so_id: number | null;
      created_from_so_tranid: string | null;
      tracking: string | null;
      tracking_urls: string[] | null;
      tracking_details: any[] | null;
      synced_at: string;
    }> = [];

    type RawLine = {
      fulfillment_id: number;
      line_id: number | null;
      line_key: string | null;
      line_no: number;
      item_id: number | null;
      item_sku: string | null;
      item_display_name: string | null;
      quantity: number;
      serial_numbers: string[] | null;
      comments: string[] | null;
    };

    let rawLines: RawLine[] = [];

    let linesRows: Array<{
      fulfillment_id: number;
      line_id: number | null;
      line_no: number;
      item_id: number | null;
      item_sku: string | null;
      item_display_name: string | null;
      quantity: number;
      serial_numbers: string[] | null;
      comments: string[] | null;
    }> = [];

    for (const id of ids) {
      const head = headerMap.get(id);
      if (!head) continue;
      const so = soById.get(id) ?? { soId: null, soTranId: null };
      const detail = detailMap.get(id) || {
        shipStatus: "",
        trackingDetails: [],
        lines: [],
      };

      for (const g of detail.lines) {
        if (!Number.isFinite(g.line_no)) continue;
        rawLines.push({
          fulfillment_id: id,
          line_id: g.line_id,
          line_key: g.line_key,
          line_no: Math.trunc(g.line_no),
          item_id: g.item_id,
          item_sku: g.item_sku,
          item_display_name: g.item_display_name,
          quantity: Math.abs(Number(g.quantity || 0)),
          serial_numbers: g.serial_numbers,
          comments: g.comments,
        });
      }

      fulfillmentsRows.push({
        fulfillment_id: id,
        tran_id: head.tran_id,
        trandate: head.trandate,
        customer_id: head.customer_id ?? null,
        ship_status: detail.shipStatus || null,
        status: head.status ?? null,
        created_from_so_id: so.soId,
        created_from_so_tranid: so.soTranId,
        tracking:
          detail.trackingDetails.map((p) => p.number).join(", ") || null,
        tracking_urls: detail.trackingDetails.map((p) => p.url),
        tracking_details: detail.trackingDetails,
        synced_at: new Date().toISOString(),
      });
    }

    if (rawLines.length) {
      const merged = new Map<string, RawLine>();
      let uniq = 0;

      for (const row of rawLines) {
        const k =
          row.line_key != null
            ? `${row.fulfillment_id}::line=${row.line_key}`
            : `${row.fulfillment_id}::uniq=${uniq++}`;

        const prev = merged.get(k);
        if (!prev) {
          merged.set(k, row);
        } else {
          if (row.serial_numbers?.length) {
            const set = new Set([
              ...(prev.serial_numbers ?? []),
              ...row.serial_numbers,
            ]);
            prev.serial_numbers = Array.from(set);
          }
          if (row.comments?.length) {
            const set = new Set([...(prev.comments ?? []), ...row.comments]);
            prev.comments = Array.from(set);
          }
        }
      }

      linesRows = Array.from(merged.values()).map(
        ({ line_key, ...rest }) => rest
      );
    }

    {
      const itemIds = Array.from(
        new Set(
          linesRows
            .map((r) => r.item_id)
            .filter((n): n is number => Number.isFinite(n as number))
        )
      );
      const meta = new Map<
        number,
        { sku: string | null; displayName: string | null }
      >();
      for (const batch of chunk(itemIds, 900)) {
        const idList = batch.join(",");
        const q = `
          SELECT
            I.id AS itemId,
            I.itemid AS sku,
            I.displayname AS displayName
          FROM item I
          WHERE I.id IN (${idList})
        `;
        const r = await netsuiteQuery(q, headers, "itemMeta");
        for (const row of r?.data?.items || []) {
          const iid = Number(row.itemid);
          if (Number.isFinite(iid)) {
            meta.set(iid, {
              sku: row.sku ?? null,
              displayName: row.displayname ?? null,
            });
          }
        }
        await new Promise((res) => setTimeout(res, 40));
      }
      for (const row of linesRows) {
        if (row.item_id != null) {
          const m = meta.get(row.item_id);
          if (m) {
            const currentSku =
              row.item_sku != null ? String(row.item_sku).trim() : "";
            const isNumericSku =
              currentSku !== "" && /^[0-9]+$/.test(currentSku);

            if (!currentSku || isNumericSku) {
              if (m.sku) row.item_sku = m.sku;
            }

            const currentDisp =
              row.item_display_name != null
                ? String(row.item_display_name).trim()
                : "";
            if (
              !currentDisp ||
              currentDisp === String(row.item_id) ||
              currentDisp === currentSku
            ) {
              if (m.displayName) row.item_display_name = m.displayName;
            }
          }
        }

        if (!row.item_display_name && row.item_sku) {
          row.item_display_name = row.item_sku;
        }
      }
    }

    if (!dry) {
      if (fulfillmentsRows.length) {
        const { error: e1 } = await supabase
          .from("fulfillments")
          .upsert(fulfillmentsRows as any, {
            onConflict: "fulfillment_id",
          });
        if (e1) throw e1;
      }
      await supabase
        .from("fulfillment_lines")
        .delete()
        .in("fulfillment_id", ids);

      if (linesRows.length) {
        const { error: e2 } = await supabase
          .from("fulfillment_lines")
          .insert(linesRows as any);
        if (e2) throw e2;
      }
    }

    upsertedCount += fulfillmentsRows.length;
  }

  const { checked, softDeleted } = scopeAll
    ? await reconcileDeletedFulfillmentsAll(supabase, headers, dry)
    : await reconcileDeletedFulfillments(
        supabase,
        headers,
        Array.from(customerSet),
        dry
      );

  if (!dry) {
    const maxCursorQ = `
      SELECT TO_CHAR(MAX(T.lastmodifieddate),'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS maxIso
      FROM transaction T
      WHERE T.type = 'ItemShip'
        AND T.lastmodifieddate >= TO_TIMESTAMP_TZ('${sinceIso}','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
    `;
    const mx = await netsuiteQuery(maxCursorQ, headers, "maxCursor");
    const maxIso = mx?.data?.items?.[0]?.maxiso || sinceIso;
    await supabase.from("sync_state").upsert(
      {
        key: "fulfillments",
        last_success_at: new Date().toISOString(),
        last_cursor: maxIso,
      },
      { onConflict: "key" }
    );
    return new Response(
      JSON.stringify({
        scanned: changedIds.length,
        upserted: upsertedCount,
        lastCursor: maxIso,
        foundModified,
        foundCreatedToday,
        foundFallbackToday,
        checked,
        softDeleted,
        throttle429: THROTTLE_429,
      }),
      { status: 200 }
    );
  }

  return new Response(
    JSON.stringify({
      scanned: changedIds.length,
      upserted: upsertedCount,
      lastCursor: sinceIso,
      foundModified,
      foundCreatedToday,
      foundFallbackToday,
      checked,
      softDeleted,
      throttle429: THROTTLE_429,
    }),
    { status: 200 }
  );
}
