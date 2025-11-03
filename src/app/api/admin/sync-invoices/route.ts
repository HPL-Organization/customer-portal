import { sendUnpaidInvoiceNotification } from "@/lib/email/templates/unpaid-invoice";
import { getValidToken } from "@/lib/netsuite/token";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import axios from "axios";
import { NextRequest } from "next/server";

type Database = {
  public: {
    Tables: {
      invoices: {
        Row: {
          invoice_id: number;
          tran_id: string | null;
          trandate: string | null;
          total: number | null;
          tax_total: number | null;
          amount_paid: number | null;
          amount_remaining: number | null;
          customer_id: number | null;
          created_from_so_id: number | null;
          created_from_so_tranid: string | null;
          netsuite_url: string | null;
          synced_at: string | null;
          ns_deleted_at: string | null;
          sales_rep: string | null;
          ship_address: string | null;
          so_reference: string | null;
          payment_processing: boolean | null;
        };
        Insert: Partial<Database["public"]["Tables"]["invoices"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["invoices"]["Row"]>;
        Relationships: [];
      };
      invoice_lines: {
        Row: {
          invoice_id: number;
          line_no: number;
          item_id: number | null;
          item_sku: string | null;
          item_display_name: string | null;
          quantity: number | null;
          rate: number | null;
          amount: number | null;
          description: string | null;
          comment: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["invoice_lines"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["invoice_lines"]["Row"]>;
        Relationships: [];
      };
      invoice_payments: {
        Row: {
          invoice_id: number;
          payment_id: number;
          tran_id: string | null;
          payment_date: string | null;
          amount: number | null;
          status: string | null;
          payment_option: string | null;
        };
        Insert: Partial<
          Database["public"]["Tables"]["invoice_payments"]["Row"]
        >;
        Update: Partial<
          Database["public"]["Tables"]["invoice_payments"]["Row"]
        >;
        Relationships: [];
      };
      profiles: {
        Row: {
          netsuite_customer_id: number | null;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      sync_state: {
        Row: {
          key: string;
          last_success_at: string | null;
          last_cursor: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["sync_state"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["sync_state"]["Row"]>;
        Relationships: [];
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
    CompositeTypes: {};
  };
};

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
  sales_rep?: string | null;
  ship_address?: string | null;
  so_reference?: string | null;
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

async function getCustomerInfo(
  customerId: number,
  headers: Record<string, string>
): Promise<{ firstName: string; email: string } | null> {
  try {
    const q = `
      SELECT
        C.firstname AS firstName,
        C.email AS email
      FROM customer C
      WHERE C.id = ${customerId}
    `;
    const r = await netsuiteQuery(q, headers, "getCustomerInfo");
    const row = r?.data?.items?.[0];
    if (row && row.firstname && row.email) {
      return {
        firstName: row.firstname.trim(),
        email: row.email.trim().toLowerCase(),
      };
    }
    return null;
  } catch (error) {
    console.error(`Failed to get customer info for ID ${customerId}:`, error);
    return null;
  }
}

function parseRetryAfterMs(val: string | number | undefined): number | null {
  if (val == null) return null;
  const s = typeof val === "number" ? String(val) : String(val).trim();
  if (/^\d+$/.test(s)) {
    return Math.max(0, parseInt(s, 10) * 1000);
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const diff = t - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
}

async function netsuiteQuery(
  q: string,
  headers: Record<string, string>,
  tag?: string
) {
  let attempt = 0;
  const delays = [500, 1000, 2000, 4000, 8000];
  const MAX_WAIT_MS = 120_000;

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
      const headersMap = err?.response?.headers || {};
      const retryAfterRaw =
        headersMap["retry-after"] ??
        headersMap["Retry-After"] ??
        headersMap["Retry-after"];

      const isConcurrency =
        status === 429 ||
        status === 503 ||
        code === "CONCURRENCY_LIMIT_EXCEEDED";

      if (isConcurrency) {
        const headerMs = parseRetryAfterMs(retryAfterRaw);
        const fallbackMs = delays[Math.min(attempt, delays.length - 1)];
        const waitMs = Math.min(
          Math.max(headerMs ?? fallbackMs, 250) +
            Math.floor(Math.random() * 250),
          MAX_WAIT_MS
        );

        if (retryAfterRaw != null) {
          console.warn(
            `[netsuiteQuery] ${tag || ""} retrying after Retry-After=${String(
              retryAfterRaw
            )} (~${waitMs}ms), attempt=${attempt + 1}`
          );
        } else {
          console.warn(
            `[netsuiteQuery] ${
              tag || ""
            } retrying with fallback backoff=${waitMs}ms, attempt=${
              attempt + 1
            }`
          );
        }

        await sleep(waitMs);
        attempt++;
        continue;
      }

      const info = {
        tag,
        status,
        body:
          typeof err?.response?.data === "string"
            ? String(err.response.data).slice(0, 600)
            : err?.response?.data,
      };
      const e = new Error(`SuiteQL ${tag || ""} failed`);
      (e as any).details = info;
      throw e;
    }
  }
}
async function fetchAllInvoiceIdsForEntities(
  headers: Record<string, string>,
  entityIdsCsv: string,
  dateFilterSql: string
): Promise<number[]> {
  const out: number[] = [];
  let lastId = 0;
  for (;;) {
    const q = `
      SELECT T.id AS invoiceId
      FROM transaction T
      WHERE T.type = 'CustInvc'
        AND T.entity IN (${entityIdsCsv})
        ${dateFilterSql}
        AND T.id > ${lastId}
      ORDER BY T.id ASC
      FETCH NEXT 1000 ROWS ONLY
    `;
    const r = await netsuiteQuery(q, headers, "forceAllIdsPage");
    const items = r?.data?.items || [];
    if (!items.length) break;
    for (const row of items) {
      const id = Number(row.invoiceid);
      if (Number.isFinite(id)) {
        out.push(id);
        lastId = id;
      }
    }
    await sleep(120);
    if (items.length < 1000) break;
  }
  return out;
}

async function resolveCustomerInternalIds(
  headers: Record<string, string>,
  inputIds: number[]
): Promise<number[]> {
  if (!inputIds.length) return [];
  const out = new Set<number>();

  for (const batch of chunk<number>(inputIds, 900)) {
    const csv = batch.join(",");

    const likeAny = batch.map((n) => `C.entityid LIKE '${n} %'`).join(" OR ");
    const q = `
  SELECT C.id AS id, C.entityid AS entityNum
  FROM customer C
  WHERE C.id IN (${csv})
     OR C.entityid IN (${batch.map((n) => `'${n}'`).join(",")})
     OR (${likeAny})
`;

    const r = await netsuiteQuery(q, headers, "resolveCustomerInternalIds");
    for (const row of r?.data?.items || []) {
      const id = Number(row.id);
      if (Number.isFinite(id)) out.add(id);
    }
    await sleep(120);
  }
  return Array.from(out);
}

async function fetchAllInvoiceIdsAllCustomers(
  headers: Record<string, string>,
  dateFilterSql: string
): Promise<number[]> {
  const out: number[] = [];
  let lastId = 0;
  for (;;) {
    const q = `
      SELECT T.id AS invoiceId
      FROM transaction T
      WHERE T.type = 'CustInvc'
        ${dateFilterSql}
        AND T.id > ${lastId}
      ORDER BY T.id ASC
      FETCH NEXT 1000 ROWS ONLY
    `;
    const r = await netsuiteQuery(q, headers, "forceAllIdsPageAll");
    const items = r?.data?.items || [];
    if (!items.length) break;
    for (const row of items) {
      const id = Number(row.invoiceid);
      if (Number.isFinite(id)) {
        out.push(id);
        lastId = id;
      }
    }
    await sleep(120);
    if (items.length < 1000) break;
  }
  return out;
}

async function reconcileDeletedInvoices(
  supabase: SupabaseClient<Database>,
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
      .from("invoices")
      .select("invoice_id")
      .in("customer_id", customerIds)
      .is("ns_deleted_at", null)
      .order("invoice_id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data || [])
      .map((r: any) => Number(r.invoice_id))
      .filter(Number.isFinite);
    if (!batch.length) break;
    localIds.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  if (!localIds.length) return { checked: 0, softDeleted: 0 };

  const missing: number[] = [];
  const voided: number[] = [];
  for (const batch of chunk<number>(localIds, 900)) {
    const idList = batch.join(",");
    const presentQ = `
      SELECT T.id AS invoiceId
      FROM transaction T
      WHERE T.type='CustInvc' AND T.id IN (${idList})
    `;
    const r1 = await netsuiteQuery(presentQ, headers, "present");
    const present = new Set<number>(
      (r1?.data?.items || []).map((x: any) => Number(x.invoiceid))
    );
    for (const id of batch) if (!present.has(id)) missing.push(id);
    if (present.size) {
      const voidedQ = `
        SELECT T.id AS invoiceId
        FROM transaction T
        WHERE T.type='CustInvc'
          AND T.id IN (${idList})
          AND LOWER(BUILTIN.DF(T.status)) LIKE '%void%'
      `;
      const r2 = await netsuiteQuery(voidedQ, headers, "voided");
      for (const row of r2?.data?.items || []) {
        const id = Number(row.invoiceid);
        if (Number.isFinite(id)) voided.push(id);
      }
    }
    await sleep(120);
  }

  const toTombstone = Array.from(new Set([...missing, ...voided]));
  if (!dry && toTombstone.length) {
    const nowIso = new Date().toISOString();
    for (const ids of chunk<number>(toTombstone, 1000)) {
      await supabase
        .from("invoices")
        .update({
          ns_deleted_at: nowIso,
        } as Database["public"]["Tables"]["invoices"]["Update"])
        .in("invoice_id", ids);
    }
  }

  return { checked: localIds.length, softDeleted: toTombstone.length };
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
  const forceSince = req.nextUrl.searchParams.get("forceSince");
  const idsParam = req.nextUrl.searchParams.get("ids");
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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
  if (!customerIds.length && !idsParam) {
    return new Response(
      JSON.stringify({
        scanned: 0,
        upserted: 0,
        message: "No customer IDs in profiles",
        checked: 0,
        softDeleted: 0,
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
    Prefer: "transient, maxpagesize=1000",
  } as Record<string, string>;

  const idSet = new Set<number>();
  let foundModified = 0;
  let foundCreatedToday = 0;
  let foundFallbackToday = 0;
  let foundPaid = 0;
  const resolveIds = req.nextUrl.searchParams.get("resolveIds") === "1";

  let effectiveCustomerIds = customerIds;
  if (resolveIds && customerIds.length) {
    effectiveCustomerIds = await resolveCustomerInternalIds(
      headers,
      customerIds
    );
  }
  const effectiveCustomerSet = new Set<number>(effectiveCustomerIds);

  const debug = req.nextUrl.searchParams.get("debug") === "1";
  if (debug) {
    return new Response(
      JSON.stringify({
        ok: true,
        count_profiles: customerIds.length,
        count_effective: effectiveCustomerIds.length,
        includes_5080: effectiveCustomerIds.includes(5080),
        sample: effectiveCustomerIds.slice(0, 20),
      }),
      { status: 200 }
    );
  }

  // --- NEW: allow scope=all for incremental path too ---
  const scope = req.nextUrl.searchParams.get("scope");
  const allScope = scope === "all";
  // -----------------------------------------------------

  if (idsParam) {
    idsParam
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .forEach((n) => idSet.add(n));
  } else if (forceAll) {
    const dateFilter = forceSince
      ? `AND T.trandate >= TO_DATE('${forceSince}','YYYY-MM-DD')`
      : "";

    if (allScope) {
      const ids = await fetchAllInvoiceIdsAllCustomers(headers, dateFilter);
      ids.forEach((n) => idSet.add(n));
    } else {
      for (const entBatch of chunk<number>(effectiveCustomerIds, 900)) {
        const entList = entBatch.join(",");
        const ids = await fetchAllInvoiceIdsForEntities(
          headers,
          entList,
          dateFilter
        );
        ids.forEach((n) => idSet.add(n));
      }
    }
  } else {
    // INCREMENTAL: if scope=all, do global queries without customer filters
    if (allScope) {
      const idsModQAll = `
        SELECT
          T.id AS invoiceId,
          TO_CHAR(T.lastmodifieddate,'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS lmIso
        FROM transaction T
        WHERE T.type = 'CustInvc'
          AND T.lastmodifieddate >= TO_TIMESTAMP_TZ('${sinceIso}','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
        ORDER BY T.lastmodifieddate ASC
      `;
      const rModAll = await netsuiteQuery(
        idsModQAll,
        headers,
        "idsModifiedAll"
      );
      for (const row of rModAll?.data?.items || []) {
        const id = Number(row.invoiceid);
        if (Number.isFinite(id)) idSet.add(id);
        foundModified++;
      }
      await sleep(120);

      const idsCreatedTodayQAll = `
        SELECT T.id AS invoiceId
        FROM transaction T
        WHERE T.type = 'CustInvc'
          AND T.trandate >= TO_DATE('${sinceDate}','YYYY-MM-DD')
        ORDER BY T.trandate ASC
      `;
      const rNewAll = await netsuiteQuery(
        idsCreatedTodayQAll,
        headers,
        "idsCreatedAll"
      );
      for (const row of rNewAll?.data?.items || []) {
        const id = Number(row.invoiceid);
        if (Number.isFinite(id)) idSet.add(id);
        foundCreatedToday++;
      }
      await sleep(120);

      const idsPaidQ = `
        SELECT DISTINCT
               TL.createdfrom AS invoiceId
        FROM transactionline TL
        JOIN transaction P
          ON P.id = TL.transaction
        WHERE P.type = 'CustPymt'
          AND TL.createdfrom IS NOT NULL
          AND P.lastmodifieddate >= TO_TIMESTAMP_TZ('${sinceIso}','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
      `;
      const rPaidAll = await netsuiteQuery(idsPaidQ, headers, "idsPaidAll");
      let batchPaid = 0;
      for (const row of rPaidAll?.data?.items || []) {
        const id = Number(row.invoiceid);
        if (Number.isFinite(id)) {
          idSet.add(id);
          foundPaid++;
          batchPaid++;
        }
      }
      console.log(`[idsPaid] added=${batchPaid}`);
      await sleep(120);

      const fallbackQAll = `
        SELECT T.id AS invoiceId
        FROM transaction T
        WHERE T.type = 'CustInvc'
          AND T.trandate >= TO_DATE('${sinceDate}','YYYY-MM-DD')
      `;
      const fbAll = await netsuiteQuery(
        fallbackQAll,
        headers,
        "fallbackIdsAll"
      );
      for (const row of fbAll?.data?.items || []) {
        const id = Number(row.invoiceid);
        if (Number.isFinite(id)) {
          idSet.add(id);
          foundFallbackToday++;
        }
      }
    } else {
      // existing per-customer incremental behavior
      for (const entBatch of chunk<number>(effectiveCustomerIds, 900)) {
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
        const r1 = await netsuiteQuery(idsModQ, headers, "idsModified");
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
        const r2 = await netsuiteQuery(idsCreatedTodayQ, headers, "idsCreated");
        for (const row of r2?.data?.items || []) {
          const id = Number(row.invoiceid);
          if (Number.isFinite(id)) idSet.add(id);
          foundCreatedToday++;
        }
        await sleep(120);

        const idsPaidQ = `
          SELECT DISTINCT
                 TL.createdfrom AS invoiceId
          FROM transactionline TL
          JOIN transaction P
            ON P.id = TL.transaction
          WHERE P.type = 'CustPymt'
            AND TL.createdfrom IS NOT NULL
            AND P.lastmodifieddate >= TO_TIMESTAMP_TZ('${sinceIso}','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
        `;
        const r3 = await netsuiteQuery(idsPaidQ, headers, "idsPaid");
        let batchPaid = 0;
        for (const row of r3?.data?.items || []) {
          const id = Number(row.invoiceid);
          if (Number.isFinite(id)) {
            idSet.add(id);
            foundPaid++;
            batchPaid++;
          }
        }
        console.log(`[idsPaid] added=${batchPaid}`);
        await sleep(120);
      }

      const fallbackQ = `
        SELECT T.id AS invoiceId, T.entity AS customerId
        FROM transaction T
        WHERE T.type = 'CustInvc'
          AND T.trandate >= TO_DATE('${sinceDate}','YYYY-MM-DD')
      `;
      const fb = await netsuiteQuery(fallbackQ, headers, "fallbackIds");
      for (const row of fb?.data?.items || []) {
        const id = Number(row.invoiceid);
        const cid = Number(row.customerid);
        if (Number.isFinite(id) && effectiveCustomerSet.has(cid)) {
          idSet.add(id);
          foundFallbackToday++;
        }
      }
    }
  }

  const changedIds = Array.from(idSet) as number[];
  if (!changedIds.length) {
    const { checked, softDeleted } = await reconcileDeletedInvoices(
      supabase,
      headers,
      effectiveCustomerIds,
      dry
    );
    if (!dry) {
      const nextCursorQ = `
        SELECT TO_CHAR(MAX(T.lastmodifieddate),'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS maxIso
        FROM transaction T
        WHERE T.type = 'CustInvc'
          AND T.lastmodifieddate >= TO_TIMESTAMP_TZ('${sinceIso}','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
      `;
      const mx = await netsuiteQuery(nextCursorQ, headers, "nextCursor");
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
          foundPaid,
          checked,
          softDeleted,
          forceAll,
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
          foundPaid,
          checked,
          softDeleted,
          forceAll,
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
        T.id           AS invoiceId,
        T.tranid       AS tranId,
        T.trandate     AS trandate,
        T.total        AS total,
        T.taxtotal     AS taxTotal,
        T.entity       AS customerId,
        NVL(TL.foreignamountunpaid,0) AS amountRemaining,
        T.custbody_hpl_so_reference AS soReference,
        (
          SELECT TRIM(BUILTIN.DF(x.DestinationAddress))
          FROM TransactionShipment x
          WHERE x.Doc = T.id
          ORDER BY x.id DESC
          FETCH NEXT 1 ROWS ONLY
        ) AS shipToText,
        (
          SELECT y.salesRepName FROM (
            SELECT BUILTIN.DF(ST.employee) AS salesRepName,
                   ROW_NUMBER() OVER (
                     PARTITION BY ST.transaction
                     ORDER BY CASE WHEN ST.isprimary = 'T' THEN 0 ELSE 1 END,
                              NVL(ST.contribution, 0) DESC
                   ) AS rn
            FROM TransactionSalesTeam ST
            WHERE ST.transaction = T.id
          ) y
          WHERE y.rn = 1
        ) AS salesRepName
      FROM transaction T
      LEFT JOIN transactionline TL
        ON TL.transaction = T.id AND TL.mainline = 'T'
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
      SELECT DISTINCT
             TL.createdfrom AS invoiceId,
             P.id          AS paymentId,
             P.tranid      AS tranId,
             P.trandate    AS paymentDate,
             BUILTIN.DF(P.status)        AS status,
             P.total                      AS amount,
             BUILTIN.DF(P.paymentoption)  AS paymentOption
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
      netsuiteQuery(headersQ, headers, "headersQ"),
      netsuiteQuery(linesQ, headers, "linesQ"),
      netsuiteQuery(paymentsQ, headers, "paymentsQ"),
      netsuiteQuery(soLinkQ, headers, "soLinkQ"),
    ]);

    const headerMap = new Map<InvoiceId, HeaderRow>();
    for (const row of h?.data?.items || []) {
      const idNum = Number(row.invoiceid) as InvoiceId;
      const total = Number(row.total ?? 0);
      const amountRemaining = Number(row.amountremaining ?? 0);
      const amountPaid = Math.max(0, total - amountRemaining);
      const rep =
        typeof row.salesrepname === "string" ? row.salesrepname.trim() : null;
      const ship =
        typeof row.shiptotext === "string" ? row.shiptotext.trim() : null;
      const soRef =
        typeof row.soreference === "string" ? row.soreference.trim() : null;
      headerMap.set(idNum, {
        invoice_id: idNum,
        tran_id: row.tranid ?? null,
        trandate: row.trandate ?? null,
        total,
        tax_total: Number(row.taxtotal ?? row.taxTotal ?? 0),
        customer_id: row.customerid != null ? Number(row.customerid) : null,
        amount_paid: amountPaid,
        amount_remaining: amountRemaining,
        sales_rep: rep || null,
        ship_address: ship || null,
        so_reference: soRef || null,
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

    const { data: existingRows } = await supabase
      .from("invoices")
      .select("invoice_id,sales_rep,ship_address,so_reference")
      .in("invoice_id", ids);

    const existingMap = new Map<
      number,
      {
        sales_rep: string | null;
        ship_address: string | null;
        so_reference: string | null;
      }
    >();
    const existingInvoiceIds = new Set<number>();
    (existingRows || []).forEach((r) => {
      existingInvoiceIds.add(r.invoice_id);
      existingMap.set(r.invoice_id, {
        sales_rep: r.sales_rep,
        ship_address: r.ship_address,
        so_reference: r.so_reference,
      });
    });

    const invoicesRows: HeaderRow[] = [];
    const linesRows: LineRow[] = [];
    const paymentsRows: PaymentRow[] = [];
    const newUnpaidInvoices: Array<{
      invoice_id: number;
      customer_id: number | null;
      total: number;
      amount_remaining: number;
      tran_id: string | null;
    }> = [];

    for (const id of ids) {
      const head = headerMap.get(id);
      if (!head) continue;

      const pmts = paymentsByInv.get(id) ?? [];
      const so = soByInv.get(id) ?? { soId: null, soTranId: null };

      const prev = existingMap.get(id);
      const rep = head.sales_rep ?? prev?.sales_rep ?? null;
      const ship = head.ship_address ?? prev?.ship_address ?? null;
      const ref = head.so_reference ?? prev?.so_reference ?? null;

      const invoiceRow = {
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
        sales_rep: rep,
        ship_address: ship,
        so_reference: ref,
      };

      invoicesRows.push(invoiceRow);

      if (
        !existingInvoiceIds.has(id) &&
        invoiceRow.amount_remaining > 0 &&
        invoiceRow.customer_id
      ) {
        newUnpaidInvoices.push({
          invoice_id: id,
          customer_id: invoiceRow.customer_id,
          total: invoiceRow.total,
          amount_remaining: invoiceRow.amount_remaining,
          tran_id: invoiceRow.tran_id,
        });
      }

      for (const ln of linesByInv.get(id) ?? []) linesRows.push(ln);
      for (const pr of pmts) paymentsRows.push(pr);
    }

    if (!dry) {
      if (invoicesRows.length) {
        const { error: e1 } = await supabase
          .from("invoices")
          .upsert(
            invoicesRows as Database["public"]["Tables"]["invoices"]["Insert"][],
            { onConflict: "invoice_id" }
          );
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
          .upsert(
            linesRows as Database["public"]["Tables"]["invoice_lines"]["Insert"][],
            { onConflict: "invoice_id,line_no" }
          );
        if (e2) throw e2;
      }
      if (paymentsRows.length) {
        const { error: e3 } = await supabase
          .from("invoice_payments")
          .upsert(
            paymentsRows as Database["public"]["Tables"]["invoice_payments"]["Insert"][],
            { onConflict: "invoice_id,payment_id" }
          );
        if (e3) throw e3;
      }
      await supabase
        .from("invoices")
        .update({ payment_processing: false })
        .in("invoice_id", ids)
        .is("payment_processing", true);
    }

    upsertedCount += invoicesRows.length;

    if (!dry && newUnpaidInvoices.length > 0) {
      console.log(
        `Sending email notifications for ${newUnpaidInvoices.length} new unpaid invoices`
      );

      const customerIds = Array.from(
        new Set(newUnpaidInvoices.map((inv) => inv.customer_id).filter(Boolean))
      ) as number[];

      const customerInfoMap = new Map<
        number,
        { firstName: string; email: string }
      >();
      for (const batch of chunk<number>(customerIds, 50)) {
        const promises = batch.map((customerId) =>
          getCustomerInfo(customerId, headers)
        );
        const results = await Promise.all(promises);

        batch.forEach((customerId, index) => {
          const info = results[index];
          if (info) {
            customerInfoMap.set(customerId, info);
          }
        });

        await sleep(120);
      }

      let emailSentCount = 0;
      for (const invoice of newUnpaidInvoices) {
        const customerInfo = invoice.customer_id
          ? customerInfoMap.get(invoice.customer_id)
          : null;
        if (!customerInfo) {
          console.warn(
            `No customer info found for invoice ${invoice.invoice_id}, customer ${invoice.customer_id}`
          );
          continue;
        }

        const testEmails = [
          "sherman@hplapidary.com",
          "raktim.verma@gmail.com",
          "vinh_nguyen1211@yahoo.com.vn",
        ];

        if (testEmails.includes(customerInfo.email)) {
          try {
            await sendUnpaidInvoiceNotification(
              {
                firstName: customerInfo.firstName,
                email: customerInfo.email,
              },
              {
                invoiceId: invoice.tran_id || `INV-${invoice.invoice_id}`,
                total: invoice.total,
                amountRemaining: invoice.amount_remaining,
              }
            );
            emailSentCount++;
            console.log(
              `Email sent for invoice ${invoice.invoice_id} to ${customerInfo.email}`
            );
          } catch (error) {
            console.error(
              `Failed to send email for invoice ${invoice.invoice_id}:`,
              error
            );
          }
        } else {
          console.log(
            `Skipping email for invoice ${invoice.invoice_id} - customer email ${customerInfo.email} not in test list`
          );
        }
      }

      console.log(
        `Email notifications sent: ${emailSentCount}/${newUnpaidInvoices.length}`
      );
    }

    await sleep(300);
  }

  const { checked, softDeleted } = await reconcileDeletedInvoices(
    supabase,
    headers,
    effectiveCustomerIds,
    dry
  );

  if (!dry) {
    const maxCursorQ = `
      SELECT TO_CHAR(MAX(T.lastmodifieddate),'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS maxIso
      FROM transaction T
      WHERE T.type = 'CustInvc'
        AND T.lastmodifieddate >= TO_TIMESTAMP_TZ('${sinceIso}','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
    `;
    const mx = await netsuiteQuery(maxCursorQ, headers, "maxCursor");
    const maxIso = mx?.data?.items?.[0]?.maxiso || sinceIso;
    await supabase.from("sync_state").upsert(
      {
        key: "invoices",
        last_success_at: new Date().toISOString(),
        last_cursor: maxIso,
      } as Database["public"]["Tables"]["sync_state"]["Insert"],
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
        foundPaid,
        checked,
        softDeleted,
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
      foundPaid,
      checked,
      softDeleted,
      forceAll,
    }),
    { status: 200 }
  );
}
