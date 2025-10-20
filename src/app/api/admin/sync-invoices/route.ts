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
const NETSUITE_UI_HOST = (
  process.env.NETSUITE_UI_HOST || `${NETSUITE_ACCOUNT_ID}.app.netsuite.com`
)
  .replace(/^https?:\/\//, "")
  .trim();
const NS_UI_BASE = `https://${NETSUITE_UI_HOST}`;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_SYNC_SECRET = process.env.ADMIN_SYNC_SECRET!;
const ADMIN_SECRET_HEADER = "x-admin-secret";

type InvoiceId = number;

interface HeaderRow {
  invoice_id: number;
  tran_id: string | null;
  trandate: string | null;
  total: number;
  tax_total: number;
  customer_id: number | null;
  amount_paid?: number;
  amount_remaining?: number;
  created_from_so_id?: number | null;
  created_from_so_tranid?: string | null;
  netsuite_url?: string | null;
  synced_at?: string;
}
interface LineRow {
  invoice_id: number;
  line_no: number;
  item_id: number | null;
  item_sku: string | null;
  item_display_name: string | null;
  quantity: number;
  rate: number;
  amount: number;
  description: string | null;
  comment: string | null;
}
interface PaymentRow {
  invoice_id: number;
  payment_id: number;
  tran_id: string | null;
  payment_date: string | null;
  amount: number;
  status: string | null;
  payment_option: string | null;
}
interface SoLink {
  soId: number | null;
  soTranId: string | null;
}

const invoiceUrl = (id: number | string) =>
  `${NS_UI_BASE}/app/accounting/transactions/custinvc.nl?whence=&id=${id}`;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function netsuiteQuery(q: string, headers: Record<string, string>) {
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
      throw err;
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

  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const lookbackDays = Number(
    req.nextUrl.searchParams.get("lookbackDays") ?? 90
  );
  const forceAll = req.nextUrl.searchParams.get("forceAll") === "1";
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
        .filter(Number.isFinite)
    )
  ) as number[];
  const customerSet = new Set<number>(customerIds);
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
    .eq("key", "invoices")
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
    Prefer: "transient",
  } as const;

  const idSet = new Set<number>();
  let foundModified = 0;
  let foundCreatedToday = 0;
  let foundFallbackToday = 0;

  if (forceAll) {
    for (const entBatch of chunk<number>(customerIds, 900)) {
      const entList = entBatch.join(",");
      const q = `
        SELECT T.id AS invoiceId
        FROM transaction T
        WHERE T.type = 'CustInvc'
          AND T.entity IN (${entList})
        ORDER BY T.trandate DESC
      `;
      const r = await netsuiteQuery(q, headers);
      for (const row of r?.data?.items || []) {
        const id = Number(row.invoiceid);
        if (Number.isFinite(id)) idSet.add(id);
      }
      await sleep(120);
    }
  } else {
    for (const entBatch of chunk<number>(customerIds, 900)) {
      const entList = entBatch.join(",");
      const idsModQ = `
        SELECT
          T.id AS invoiceId,
          TO_CHAR(T.lastmodifieddate,'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS lmIso
        FROM transaction T
        WHERE T.type = 'CustInvc'
          AND T.entity IN (${entList})
          AND T.lastmodifieddate >= TO_TIMESTAMP_TZ('${sinceIso}','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
        ORDER BY T.lastmodifieddate ASC
      `;
      const r1 = await netsuiteQuery(idsModQ, headers);
      for (const row of r1?.data?.items || []) {
        const id = Number(row.invoiceid);
        if (Number.isFinite(id)) idSet.add(id);
        foundModified++;
      }
      await sleep(120);

      const idsCreatedTodayQ = `
        SELECT T.id AS invoiceId
        FROM transaction T
        WHERE T.type = 'CustInvc'
          AND T.entity IN (${entList})
          AND T.trandate >= TO_DATE('${sinceDate}','YYYY-MM-DD')
        ORDER BY T.trandate ASC
      `;
      const r2 = await netsuiteQuery(idsCreatedTodayQ, headers);
      for (const row of r2?.data?.items || []) {
        const id = Number(row.invoiceid);
        if (Number.isFinite(id)) idSet.add(id);
        foundCreatedToday++;
      }
      await sleep(120);
    }

    const fallbackQ = `
      SELECT T.id AS invoiceId, T.entity AS customerId
      FROM transaction T
      WHERE T.type = 'CustInvc'
        AND T.trandate >= TO_DATE('${sinceDate}','YYYY-MM-DD')
    `;
    const fb = await netsuiteQuery(fallbackQ, headers);
    for (const row of fb?.data?.items || []) {
      const id = Number(row.invoiceid);
      const cid = Number(row.customerid);
      if (Number.isFinite(id) && customerSet.has(cid)) {
        idSet.add(id);
        foundFallbackToday++;
      }
    }
  }

  const changedIds = Array.from(idSet) as number[];
  if (!changedIds.length) {
    if (!dry) {
      const nextCursorQ = `
        SELECT TO_CHAR(MAX(T.lastmodifieddate),'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS maxIso
        FROM transaction T
        WHERE T.type = 'CustInvc'
          AND T.lastmodifieddate >= TO_TIMESTAMP_TZ('${sinceIso}','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
      `;
      const mx = await netsuiteQuery(nextCursorQ, headers);
      const maxIso = mx?.data?.items?.[0]?.maxiso || sinceIso;
      await supabase.from("sync_state").upsert(
        {
          key: "invoices",
          last_success_at: new Date().toISOString(),
          last_cursor: maxIso,
        },
        { onConflict: "key" }
      );
      return new Response(
        JSON.stringify({
          scanned: 0,
          upserted: 0,
          lastCursor: maxIso,
          foundModified,
          foundCreatedToday,
          foundFallbackToday,
        }),
        { status: 200 }
      );
    } else {
      return new Response(
        JSON.stringify({
          scanned: 0,
          upserted: 0,
          lastCursor: sinceIso,
          foundModified,
          foundCreatedToday,
          foundFallbackToday,
        }),
        { status: 200 }
      );
    }
  }

  let upsertedCount = 0;
  for (const ids of chunk<InvoiceId>(changedIds, 300)) {
    const idList = ids.join(",");

    const headersQ = `
      SELECT
        T.id AS invoiceId,
        T.tranid AS tranId,
        T.trandate AS trandate,
        T.total AS total,
        T.taxtotal AS taxTotal,
        T.entity AS customerId,
        NVL(TL.foreignamountunpaid,0) AS amountRemaining
      FROM transaction T
      JOIN transactionline TL ON TL.transaction = T.id AND TL.mainline = 'T'
      WHERE T.type = 'CustInvc' AND T.id IN (${idList})
    `;
    const linesQ = `
      SELECT TL.transaction AS invoiceId, TL.linesequencenumber AS lineNo, I.id AS itemId, I.itemid AS sku, I.displayname AS displayName,
             NVL(ABS(TL.quantity),0) AS quantity, TL.rate AS rate, NVL(ABS(TL.amount),0) AS amount, TL.memo AS description, TL.custcolns_comment AS lineComment
      FROM transactionline TL
      JOIN item I ON I.id = TL.item
      WHERE TL.transaction IN (${idList})
    `;
    const paymentsQ = `
      SELECT TL.createdfrom AS invoiceId, P.id AS paymentId, P.tranid AS tranId, P.trandate AS paymentDate,
             BUILTIN.DF(P.status) AS status, P.total AS amount, BUILTIN.DF(P.paymentoption) AS paymentOption
      FROM transaction P
      JOIN transactionline TL ON TL.transaction = P.id
      WHERE P.type = 'CustPymt' AND TL.createdfrom IN (${idList})
    `;
    const soLinkQ = `
      SELECT PTL.NextDoc AS invoiceId, PTL.PreviousDoc AS soId, S.tranid AS soTranId
      FROM PreviousTransactionLink PTL
      JOIN transaction S ON S.id = PTL.PreviousDoc
      WHERE PTL.NextDoc IN (${idList}) AND S.type='SalesOrd'
    `;

    const [h, l, p, s] = await Promise.all([
      netsuiteQuery(headersQ, headers),
      netsuiteQuery(linesQ, headers),
      netsuiteQuery(paymentsQ, headers),
      netsuiteQuery(soLinkQ, headers),
    ]);

    const headerMap = new Map<InvoiceId, HeaderRow>();
    for (const row of h?.data?.items || []) {
      const idNum = Number(row.invoiceid) as InvoiceId;
      const total = Number(row.total ?? 0);
      const amountRemaining = Number(row.amountremaining ?? 0);
      const amountPaid = Math.max(0, total - amountRemaining);
      headerMap.set(idNum, {
        invoice_id: idNum,
        tran_id: row.tranid ?? null,
        trandate: row.trandate ?? null,
        total,
        tax_total: Number(row.taxtotal ?? row.taxTotal ?? 0),
        customer_id: row.customerid != null ? Number(row.customerid) : null,
        amount_paid: amountPaid,
        amount_remaining: amountRemaining,
      });
    }

    const linesByInv = new Map<InvoiceId, LineRow[]>();
    for (const r of l?.data?.items || []) {
      const inv = Number(r.invoiceid) as InvoiceId;
      if (!linesByInv.has(inv)) linesByInv.set(inv, []);
      linesByInv.get(inv)!.push({
        invoice_id: inv,
        line_no: Number(r.lineno ?? r.linesequencenumber ?? 0),
        item_id: r.itemid != null ? Number(r.itemid) : null,
        item_sku: r.sku ?? null,
        item_display_name: (r.displayname as string | null) ?? r.sku ?? null,
        quantity: Number(r.quantity ?? 0),
        rate: Number(r.rate ?? 0),
        amount: Number(r.amount ?? 0),
        description: (r.description as string | null) ?? null,
        comment: (r.linecomment as string | null) ?? null,
      });
    }

    const paymentsByInv = new Map<InvoiceId, PaymentRow[]>();
    for (const r of p?.data?.items || []) {
      const inv = Number(r.invoiceid) as InvoiceId;
      if (!paymentsByInv.has(inv)) paymentsByInv.set(inv, []);
      paymentsByInv.get(inv)!.push({
        invoice_id: inv,
        payment_id: Number(r.paymentid),
        tran_id: r.tranid ?? null,
        payment_date: r.paymentdate ?? null,
        amount: Number(r.amount ?? 0),
        status: (r.status as string | null) ?? null,
        payment_option: (r.paymentoption as string | null) ?? null,
      });
    }

    const soByInv = new Map<InvoiceId, SoLink>();
    for (const r of s?.data?.items || []) {
      const inv = Number(r.invoiceid) as InvoiceId;
      const soId = r.soid != null ? Number(r.soid) : null;
      const soTranId = (r.sotranid as string | null) ?? null;
      soByInv.set(inv, { soId, soTranId });
    }

    const invoicesRows: HeaderRow[] = [];
    const linesRows: LineRow[] = [];
    const paymentsRows: PaymentRow[] = [];

    for (const id of ids) {
      const head = headerMap.get(id);
      if (!head) continue;

      const pmts = paymentsByInv.get(id) ?? [];
      const so = soByInv.get(id) ?? { soId: null, soTranId: null };

      invoicesRows.push({
        invoice_id: id,
        tran_id: head.tran_id,
        trandate: head.trandate,
        total: Number(head.total || 0),
        tax_total: Number(head.tax_total || 0),
        amount_paid: Number(head.amount_paid || 0),
        amount_remaining: Number(head.amount_remaining || 0),
        customer_id: head.customer_id,
        created_from_so_id: so.soId,
        created_from_so_tranid: so.soTranId,
        netsuite_url: invoiceUrl(id),
        synced_at: new Date().toISOString(),
      });

      for (const ln of linesByInv.get(id) ?? []) linesRows.push(ln);
      for (const pr of pmts) paymentsRows.push(pr);
    }

    if (!dry) {
      if (invoicesRows.length) {
        const { error: e1 } = await supabase
          .from("invoices")
          .upsert(invoicesRows as any, { onConflict: "invoice_id" });
        if (e1) throw e1;
      }
      for (const invId of ids) {
        await supabase.from("invoice_lines").delete().eq("invoice_id", invId);
        await supabase
          .from("invoice_payments")
          .delete()
          .eq("invoice_id", invId);
      }
      if (linesRows.length) {
        const { error: e2 } = await supabase
          .from("invoice_lines")
          .upsert(linesRows as any, { onConflict: "invoice_id,line_no" });
        if (e2) throw e2;
      }
      if (paymentsRows.length) {
        const { error: e3 } = await supabase
          .from("invoice_payments")
          .upsert(paymentsRows as any, { onConflict: "invoice_id,payment_id" });
        if (e3) throw e3;
      }
    }

    upsertedCount += invoicesRows.length;
    await sleep(300);
  }

  if (!dry) {
    const maxCursorQ = `
      SELECT TO_CHAR(MAX(T.lastmodifieddate),'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS maxIso
      FROM transaction T
      WHERE T.type = 'CustInvc'
        AND T.lastmodifieddate >= TO_TIMESTAMP_TZ('${sinceIso}','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
    `;
    const mx = await netsuiteQuery(maxCursorQ, headers);
    const maxIso = mx?.data?.items?.[0]?.maxiso || sinceIso;
    await supabase.from("sync_state").upsert(
      {
        key: "invoices",
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
        forceAll,
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
      forceAll,
    }),
    { status: 200 }
  );
}
