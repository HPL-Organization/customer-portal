// src/app/api/netsuite/test-invoice/route.ts
import { NextRequest } from "next/server";
import axios from "axios";
import { getValidToken } from "@/lib/netsuite/token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;
const NETSUITE_UI_HOST = (
  process.env.NETSUITE_UI_HOST || `${NETSUITE_ACCOUNT_ID}.app.netsuite.com`
)
  .replace(/^https?:\/\//, "")
  .trim();
const NS_UI_BASE = `https://${NETSUITE_UI_HOST}`;
const ADMIN_SYNC_SECRET = process.env.ADMIN_SYNC_SECRET!;
const ADMIN_SECRET_HEADER = "x-admin-secret";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const invoiceUrl = (id: number | string) =>
  `${NS_UI_BASE}/app/accounting/transactions/custinvc.nl?whence=&id=${id}`;

async function suiteQL(
  q: string,
  headers: Record<string, string>,
  tag?: string
) {
  let attempt = 0;
  const delays = [500, 1000, 2000, 4000, 8000];
  for (;;) {
    try {
      return await axios.post(
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
        await sleep(d);
        attempt++;
        continue;
      }
      const e = new Error(`SuiteQL ${tag || ""} failed`);
      (e as any).details = { status, data: err?.response?.data };
      throw e;
    }
  }
}

async function resolveCustomerInternalId(
  headers: Record<string, string>,
  inputId: number
): Promise<number | null> {
  const q = `
    SELECT C.id AS id
    FROM customer C
    WHERE C.id = ${inputId}
       OR C.entityid = '${String(inputId)}'
  `;
  const r = await suiteQL(q, headers, "resolveCustomerInternalId");
  const row = (r?.data?.items || [])[0];
  const id = Number(row?.id);
  return Number.isFinite(id) ? id : null;
}

async function expandToChildren(
  headers: Record<string, string>,
  baseIds: number[]
): Promise<number[]> {
  if (!baseIds.length) return [];
  const out = new Set<number>(baseIds);
  for (let i = 0; i < baseIds.length; i += 900) {
    const slice = baseIds.slice(i, i + 900);
    const csv = slice.join(",");
    const subQ = `SELECT C.id AS id FROM customer C WHERE C.parent IN (${csv})`;
    const jobQ = `SELECT J.id AS id FROM job J WHERE J.customer IN (${csv})`;
    const [sub, job] = await Promise.all([
      suiteQL(subQ, headers, "expand:subcustomers"),
      suiteQL(jobQ, headers, "expand:jobs"),
    ]);
    for (const row of sub?.data?.items || []) {
      const id = Number(row.id);
      if (Number.isFinite(id)) out.add(id);
    }
    for (const row of job?.data?.items || []) {
      const id = Number(row.id);
      if (Number.isFinite(id)) out.add(id);
    }
    await sleep(120);
  }
  return Array.from(out);
}

async function fetchInvoicesForEntities(
  headers: Record<string, string>,
  entityIds: number[]
) {
  const results: any[] = [];
  for (let i = 0; i < entityIds.length; i += 900) {
    const entCsv = entityIds.slice(i, i + 900).join(",");
    let lastId = 0;
    for (;;) {
      const q = `
        SELECT
          T.id AS invoiceId,
          T.tranid AS tranId,
          T.trandate AS trandate,
          T.entity AS entityId,
          BUILTIN.DF(T.entity) AS entityName,
          NVL(TL.foreignamountunpaid,0) AS amountRemaining,
          T.total AS total,
          T.taxtotal AS taxTotal
        FROM transaction T
        LEFT JOIN transactionline TL
          ON TL.transaction = T.id AND TL.mainline = 'T'
        WHERE T.type='CustInvc'
          AND T.entity IN (${entCsv})
          AND T.id > ${lastId}
        ORDER BY T.id ASC
        FETCH NEXT 1000 ROWS ONLY
      `;
      const r = await suiteQL(q, headers, "invoicesByEntitiesPage");
      const items = r?.data?.items || [];
      if (!items.length) break;
      for (const row of items) {
        const rid = Number(row.invoiceid);
        results.push({
          invoice_id: rid,
          tran_id: row.tranid ?? null,
          trandate: row.trandate ?? null,
          entity_id: Number(row.entityid ?? row.entityId ?? 0) || null,
          entity_name: row.entityname ?? null,
          total: Number(row.total ?? 0),
          tax_total: Number(row.taxtotal ?? 0),
          amount_remaining: Number(row.amountremaining ?? 0),
          netsuite_url: invoiceUrl(rid),
        });
        lastId = rid;
      }
      await sleep(120);
      if (items.length < 1000) break;
    }
  }
  return results;
}

async function fetchSingleInvoice(
  headers: Record<string, string>,
  invoiceId: number
) {
  const headerQ = `
    SELECT
      T.id           AS invoiceId,
      T.tranid       AS tranId,
      T.trandate     AS trandate,
      T.total        AS total,
      T.taxtotal     AS taxTotal,
      T.entity       AS customerId,
      BUILTIN.DF(T.entity) AS customerName,
      NVL(TL.foreignamountunpaid,0) AS amountRemaining
    FROM transaction T
    LEFT JOIN transactionline TL
      ON TL.transaction = T.id AND TL.mainline = 'T'
    WHERE T.type='CustInvc' AND T.id = ${invoiceId}
  `;
  const r = await suiteQL(headerQ, headers, "singleHeader");
  const head = (r?.data?.items || [])[0];
  if (!head) return null;
  const total = Number(head.total ?? 0);
  const amount_remaining = Number(head.amountremaining ?? 0);
  const amount_paid = Math.max(0, total - amount_remaining);
  return {
    invoice_id: Number(head.invoiceid),
    tran_id: head.tranid ?? null,
    trandate: head.trandate ?? null,
    total,
    tax_total: Number(head.taxtotal ?? 0),
    customer_id: head.customerid != null ? Number(head.customerid) : null,
    customer_name: head.customername ?? null,
    amount_paid,
    amount_remaining,
    netsuite_url: invoiceUrl(invoiceId),
  };
}

async function handle(req: NextRequest) {
  if (
    !ADMIN_SYNC_SECRET ||
    req.headers.get(ADMIN_SECRET_HEADER) !== ADMIN_SYNC_SECRET
  ) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
    });
  }

  const token = await getValidToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    Prefer: "transient, maxpagesize=1000",
  } as Record<string, string>;

  const idParam = req.nextUrl.searchParams.get("id");
  const customerParam = req.nextUrl.searchParams.get("customerId");
  const resolve = req.nextUrl.searchParams.get("resolve") === "1";
  const expand = req.nextUrl.searchParams.get("expand") === "1";

  if (idParam) {
    const invoiceId = Number(idParam);
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
      return new Response(JSON.stringify({ ok: false, error: "invalid id" }), {
        status: 400,
      });
    }
    const data = await fetchSingleInvoice(headers, invoiceId);
    if (!data) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invoice not found" }),
        { status: 404 }
      );
    }
    return new Response(JSON.stringify({ ok: true, mode: "byInvoice", data }), {
      status: 200,
    });
  }

  if (customerParam) {
    const raw = Number(customerParam);
    if (!Number.isFinite(raw) || raw <= 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid customerId" }),
        { status: 400 }
      );
    }

    let resolvedId = raw;
    if (resolve) {
      const r = await resolveCustomerInternalId(headers, raw);
      if (r) resolvedId = r;
    }

    let entities = [resolvedId];
    if (expand) {
      entities = await expandToChildren(headers, [resolvedId]);
    }

    const invoices = await fetchInvoicesForEntities(headers, entities);

    return new Response(
      JSON.stringify({
        ok: true,
        mode: "byCustomer",
        input_customer: raw,
        resolved_customer: resolvedId,
        expanded_entities: entities,
        count: invoices.length,
        invoices,
      }),
      { status: 200 }
    );
  }

  return new Response(
    JSON.stringify({
      ok: false,
      error: "Provide ?id=12345 or ?customerId=5080",
    }),
    { status: 400 }
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
