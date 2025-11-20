// app/api/netsuite/test-fulfillment-three/route.ts
import { NextRequest } from "next/server";
import axios from "axios";
import { getValidToken } from "@/lib/netsuite/token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;
const ADMIN_SYNC_SECRET = process.env.ADMIN_SYNC_SECRET!;
const ADMIN_SECRET_HEADER = "x-admin-secret";

const http = axios.create({ timeout: 60000 });

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function netsuiteQuery(
  q: string,
  headers: Record<string, string>,
  tag?: string
) {
  const delays = [500, 1000, 2000, 4000, 8000];
  let attempt = 0;
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
      const transient =
        status === 429 ||
        code === "CONCURRENCY_LIMIT_EXCEEDED" ||
        (status >= 500 && status < 600) ||
        err?.code === "ECONNABORTED";
      if (transient) {
        const d = delays[Math.min(attempt, delays.length - 1)];
        await sleep(d);
        attempt++;
        continue;
      }
      const e = new Error("SuiteQL " + (tag || "") + " failed");
      (e as any).details = {
        tag,
        status,
        code,
        detail:
          err?.response?.data?.["o:errorDetails"]?.[0]?.detail ||
          err?.response?.data,
        q,
      };
      throw e;
    }
  }
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

  const url = new URL(req.url);
  const idParam = url.searchParams.get("id");
  const idsCsv = url.searchParams.get("ids");
  const customerIdParam = url.searchParams.get("customerId");
  const days = Math.max(1, Number(url.searchParams.get("days") ?? 30));
  const limit = Math.max(
    1,
    Math.min(1000, Number(url.searchParams.get("limit") ?? 50))
  );

  const token = await getValidToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    Prefer: "transient, maxpagesize=1000",
  } as Record<string, string>;

  let ids: number[] = [];

  if (idsCsv) {
    ids = idsCsv
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  } else if (idParam) {
    const n = Number(idParam);
    if (Number.isFinite(n) && n > 0) ids = [n];
  } else if (customerIdParam) {
    const cid = Number(customerIdParam);
    if (Number.isFinite(cid) && cid > 0) {
      const q = `
        SELECT T.id AS fulfillmentId
        FROM transaction T
        WHERE T.type='ItemShip'
          AND T.entity = ${cid}
          AND T.trandate >= BUILTIN.RELATIVE_RANGES('DAGO${days}','START')
        ORDER BY T.trandate DESC, T.id DESC
        FETCH NEXT ${limit} ROWS ONLY
      `;
      const r = await netsuiteQuery(q, headers, "pickIFForCustomer");
      ids = (r?.data?.items || [])
        .map((row: any) => Number(row.fulfillmentid))
        .filter((n: any) => Number.isFinite(n) && n > 0);
    }
  } else {
    const q = `
      SELECT T.id AS fulfillmentId
      FROM transaction T
      WHERE T.type='ItemShip'
        AND T.trandate >= BUILTIN.RELATIVE_RANGES('DAGO${days}','START')
      ORDER BY T.trandate DESC, T.id DESC
      FETCH NEXT ${limit} ROWS ONLY
    `;
    const r = await netsuiteQuery(q, headers, "pickRecentIF");
    ids = (r?.data?.items || [])
      .map((row: any) => Number(row.fulfillmentid))
      .filter((n: any) => Number.isFinite(n) && n > 0);
  }

  if (!ids.length) {
    return new Response(
      JSON.stringify({ ok: true, ids: [], note: "No fulfillments matched." }),
      { status: 200 }
    );
  }

  const out: any[] = [];

  for (const batch of chunk(ids, 900)) {
    const idList = batch.join(",");

    const headersQ = `
      SELECT
        T.id AS fulfillmentId,
        T.tranid AS tranId,
        T.trandate AS tranDate,
        T.entity AS customerId,
        BUILTIN.DF(T.entity) AS customerName,
        BUILTIN.DF(T.status) AS status
      FROM transaction T
      WHERE T.type='ItemShip' AND T.id IN (${idList})
    `;

    const shipmentQ = `
      SELECT
        S.Doc AS fulfillmentId,
        TRIM(BUILTIN.DF(S.SourceAddress)) AS shipFrom,
        TRIM(BUILTIN.DF(S.DestinationAddress)) AS shipTo,
        TRIM(BUILTIN.DF(S.ShippingMethod)) AS shipMethod,
        S.Weight AS weight,
        S.ShippingRate AS shippingRate,
        S.HandlingRate AS handlingRate
      FROM TransactionShipment S
      WHERE S.Doc IN (${idList})
    `;

    const soQ = `
      SELECT
        TL.Transaction AS fulfillmentId,
        TL.CreatedFrom AS soId,
        SO.tranid AS soTranId,
        SO.otherrefnum AS soPONumber
      FROM transactionline TL
      JOIN transaction SO ON SO.id = TL.CreatedFrom
      WHERE TL.Transaction IN (${idList})
        AND TL.mainline = 'T'
        AND SO.type = 'SalesOrd'
    `;

    const linesQ = `
      SELECT
        TL.transaction AS fulfillmentId,
        TL.linesequencenumber AS lineNo,
        I.id AS itemId,
        I.itemid AS sku,
        I.displayname AS displayName,
        NVL(ABS(TL.quantity),0) AS quantity,
        TL.memo AS description,
        TL.custcol_hpl_comment AS comment
      FROM transactionline TL
      JOIN item I ON I.id = TL.item
      WHERE TL.transaction IN (${idList})
    `;

    const trackingQ = `
      SELECT
        T.id AS fulfillmentId,
        TN.TrackingNumber AS trackingNumber
      FROM transaction T
      JOIN TrackingNumberMap TNM ON TNM.Transaction = T.id
      JOIN TrackingNumber TN ON TN.id = TNM.TrackingNumber
      WHERE T.type='ItemShip' AND T.id IN (${idList})
    `;

    const [H, S, SO, L, TRK] = await Promise.all([
      netsuiteQuery(headersQ, headers, "headersQ"),
      netsuiteQuery(shipmentQ, headers, "shipmentQ"),
      netsuiteQuery(soQ, headers, "soQ"),
      netsuiteQuery(linesQ, headers, "linesQ"),
      netsuiteQuery(trackingQ, headers, "trackingQ"),
    ]);

    const headMap = new Map<number, any>();
    for (const r of H?.data?.items || []) {
      const id = Number(r.fulfillmentid);
      if (!Number.isFinite(id)) continue;
      headMap.set(id, {
        fulfillmentId: id,
        tranId: r.tranid ?? null,
        tranDate: r.trandate ?? null,
        customerId: r.customerid != null ? Number(r.customerid) : null,
        customerName: r.customername ?? null,
        status: r.status ?? null,
        shipFrom: null,
        shipTo: null,
        shipMethod: null,
        weight: null,
        shippingRate: null,
        handlingRate: null,
        soId: null,
        soTranId: null,
        soPONumber: null,
        trackingNumbers: [] as string[],
        lines: [] as any[],
      });
    }

    for (const r of S?.data?.items || []) {
      const id = Number(r.fulfillmentid);
      const h = headMap.get(id);
      if (!h) continue;
      h.shipFrom = r.shipfrom ?? null;
      h.shipTo = r.shipto ?? null;
      h.shipMethod = r.shipmethod ?? null;
      h.weight = r.weight ?? null;
      h.shippingRate = r.shippingrate ?? null;
      h.handlingRate = r.handlingrate ?? null;
    }

    for (const r of SO?.data?.items || []) {
      const id = Number(r.fulfillmentid);
      const h = headMap.get(id);
      if (!h) continue;
      h.soId = r.soid != null ? Number(r.soid) : null;
      h.soTranId = r.sotranid ?? null;
      h.soPONumber = r.soponumber ?? null;
    }

    const linesById = new Map<number, any[]>();
    for (const r of L?.data?.items || []) {
      const id = Number(r.fulfillmentid);
      if (!linesById.has(id)) linesById.set(id, []);
      linesById.get(id)!.push({
        lineNo: Number(r.lineno ?? 0),
        itemId: r.itemid != null ? Number(r.itemid) : null,
        sku: r.sku ?? null,
        displayName: (r.displayname as string | null) ?? r.sku ?? null,
        quantity: Number(r.quantity ?? 0),
        description: (r.description as string | null) ?? null,
        comment: (r.comment as string | null) ?? null,
      });
    }

    const trackById = new Map<number, Set<string>>();
    for (const r of TRK?.data?.items || []) {
      const id = Number(r.fulfillmentid);
      const num = (r.trackingnumber as string | null) ?? null;
      if (!Number.isFinite(id) || !num) continue;
      if (!trackById.has(id)) trackById.set(id, new Set());
      trackById.get(id)!.add(String(num).trim());
    }

    for (const id of batch) {
      const h = headMap.get(id);
      if (!h) continue;
      h.lines = linesById.get(id) || [];
      h.trackingNumbers = Array.from(trackById.get(id) || new Set<string>());
      out.push(h);
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      count: out.length,
      ids,
      results: out,
      note: "Fetched via SuiteQL only (headers, shipment, SO link, tracking, and lines). If this covers your data needs, we can refactor the main fulfillment sync to SuiteQL-only.",
    }),
    { status: 200 }
  );
}
