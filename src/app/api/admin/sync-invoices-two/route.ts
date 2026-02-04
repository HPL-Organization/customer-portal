import { NextRequest } from "next/server";
import axios from "axios";
import { getValidToken } from "@/lib/netsuite/token";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { sendUnpaidInvoiceNotification } from "@/lib/email/templates/unpaid-invoice";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

const ADMIN_SYNC_SECRET = process.env.ADMIN_SYNC_SECRET!;
const ADMIN_SECRET_HEADER = "x-admin-secret";

const MANIFEST_FOLDER_ID = Number(process.env.NS_EXPORT_FOLDER_ID || 2279);
const MANIFEST_NAME = "manifest_latest.json";

const RL_SCRIPT_ID = 2935;
const RL_DEPLOY_ID = "customdeploy1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type ManifestShape = {
  generated_at: string;
  files: {
    invoices: { id: string | number; name: string; rows: number };
    invoice_lines: { id: string | number; name: string; rows: number };
    invoice_payments: { id: string | number; name: string; rows: number };
  };
};

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
        payment_processing: boolean;
        is_backordered: boolean | null;
        giveaway: boolean | null;
        warranty: boolean | null;
        created_at: string | null;
        created_by: string | null;
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
    };
    Views: {};
    Functions: {};
    Enums: {};
    CompositeTypes: {};
  };
};

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    Prefer: "transient, maxpagesize=1000",
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfterMs(val: string | number | undefined): number | null {
  if (val == null) return null;
  const s = typeof val === "number" ? String(val) : String(val).trim();
  if (/^\d+$/.test(s)) return Math.max(0, parseInt(s, 10) * 1000);
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const diff = t - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
}

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
        firstName: String(row.firstname).trim(),
        email: String(row.email).trim().toLowerCase(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function netsuiteQuery(
  q: string,
  headers: Record<string, string>,
  tag?: string
) {
  let attempt = 0;
  const delays = [500, 1000, 2000, 4000, 8000];
  const MAX_WAIT_MS = 120000;
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
      const ra =
        headersMap["retry-after"] ??
        headersMap["Retry-After"] ??
        headersMap["Retry-after"];
      if (
        status === 429 ||
        status === 503 ||
        code === "CONCURRENCY_LIMIT_EXCEEDED"
      ) {
        const h = parseRetryAfterMs(ra);
        const backoff = h ?? delays[Math.min(attempt, delays.length - 1)];
        await sleep(Math.min(Math.max(backoff, 250), MAX_WAIT_MS));
        attempt++;
        continue;
      }
      const e = new Error(`SuiteQL ${tag || ""} failed`);
      (e as any).details = {
        status,
        body:
          typeof err?.response?.data === "string"
            ? String(err.response.data).slice(0, 600)
            : err?.response?.data,
      };
      throw e;
    }
  }
}

async function getFileIdByNameInFolder(
  headers: Record<string, string>,
  name: string,
  folderId: number
): Promise<number | null> {
  const q = `
    SELECT id
    FROM file
    WHERE name = '${name.replace(/'/g, "''")}'
      AND folder = ${folderId}
    ORDER BY id DESC
    FETCH NEXT 1 ROWS ONLY
  `;
  const r = await netsuiteQuery(q, headers, "findManifest");
  const id = Number(r?.data?.items?.[0]?.id);
  return Number.isFinite(id) ? id : null;
}

function restletUrl(accountId: string) {
  return `https://${accountId}.app.netsuite.com/app/site/hosting/restlet.nl`;
}

function asJson(data: any) {
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data && typeof data === "object" ? data : null;
}

function stripBom(s: string) {
  if (s && s.charCodeAt(0) === 0xfeff) return s.slice(1);
  return s;
}

async function restletGetLines(
  token: string,
  fileId: number | string,
  pageLines = 1000
) {
  const url = restletUrl(NETSUITE_ACCOUNT_ID);
  let out = "";
  let lineStart = 0;

  for (;;) {
    const r = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      params: {
        script: String(RL_SCRIPT_ID),
        deploy: String(RL_DEPLOY_ID),
        id: String(fileId),
        lineStart: String(lineStart),
        maxLines: String(pageLines),
      },
      transformResponse: (x) => x,
      validateStatus: () => true,
    });

    const body = asJson(r.data);
    if (r.status < 200 || r.status >= 300 || !body || !body.ok) {
      const e = new Error(`RestletFetchFailed ${r.status}`);
      (e as any).details =
        typeof r.data === "string" ? r.data : JSON.stringify(r.data);
      throw e;
    }

    const text = stripBom(String(body.data || ""));
    if (text.length) {
      if (out.length) out += "\n";
      out += text;
    }

    const returned = Number(body.linesReturned || 0);
    if (body.done || returned < pageLines) break;
    lineStart += returned;
  }

  return out;
}

function parseJsonl(text: string) {
  const lines = text.split(/\r?\n/);
  const out: any[] = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch {
      continue;
    }
  }
  return out;
}

function nearEq(a: any, b: any, eps = 0.01) {
  if (a == null && b == null) return true;
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isFinite(na) || !Number.isFinite(nb))
      return String(a) === String(b);
    return Math.abs(na - nb) <= eps;
  }
  return a === b;
}

function diffObject(
  before: Record<string, any>,
  after: Record<string, any>,
  fields: string[],
  numericFields: Set<string>
) {
  const changes: Record<string, { before: any; after: any }> = {};
  for (const f of fields) {
    const was = before?.[f] ?? null;
    const now = after?.[f] ?? null;
    const eq = numericFields.has(f) ? nearEq(was, now) : was === now;
    if (!eq) changes[f] = { before: was, after: now };
  }
  return changes;
}

async function fetchExistingInBatches<T>(
  supabase: SupabaseClient<Database>,
  table: "invoices" | "invoice_lines" | "invoice_payments",
  cols: string[],
  keyCol: "invoice_id",
  ids: number[]
): Promise<T[]> {
  const out: T[] = [];
  const batch = 1000;
  for (let i = 0; i < ids.length; i += batch) {
    const slice = ids.slice(i, i + batch);
    const q = supabase.from(table).select(cols.join(",")).in(keyCol, slice);
    const { data, error } = await q;
    if (error) throw error;
    if (data && data.length) out.push(...(data as T[]));
  }
  return out;
}

function normalizeUsDateToIso(d: any): string | null {
  if (d === undefined || d === null) return null;
  const s = String(d).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

async function fetchActiveInvoiceIds(
  supabase: SupabaseClient<Database>
): Promise<number[]> {
  const out: number[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("invoices")
      .select("invoice_id")
      .is("ns_deleted_at", null)
      .order("invoice_id", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data) out.push(Number(r.invoice_id));
    if (data.length < page) break;
    from += page;
  }
  return out;
}

function coerceNull<T = any>(v: T): T | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
}

function toNumOrNull(v: any): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
async function upsertSnapshotToSupabase(
  supabase: SupabaseClient<Database>,
  fileInvoices: any[],
  fileLines: any[],
  filePayments: any[],
  dbInvMap: Map<number, Database["public"]["Tables"]["invoices"]["Row"]>,
  fileInvoiceIds: number[],
  missingInFiles: number[]
) {
  const nowIso = new Date().toISOString();

  const toInvoiceRow = (
    f: any
  ): Database["public"]["Tables"]["invoices"]["Insert"] => {
    const existing = dbInvMap.get(Number(f.invoice_id));
    return {
      invoice_id: Number(f.invoice_id),
      tran_id: coerceNull(f.tran_id),
      trandate: normalizeUsDateToIso(coerceNull(f.trandate)),
      total: toNumOrNull(f.total),
      tax_total: toNumOrNull(f.tax_total),
      amount_paid: toNumOrNull(f.amount_paid),
      amount_remaining: toNumOrNull(f.amount_remaining),
      customer_id: toNumOrNull(f.customer_id),
      created_from_so_id: toNumOrNull(f.created_from_so_id),
      created_from_so_tranid: coerceNull(f.created_from_so_tranid),
      netsuite_url: coerceNull(existing?.netsuite_url),
      ns_deleted_at: null,
      sales_rep: coerceNull(f.sales_rep),
      ship_address: coerceNull(f.ship_address),
      so_reference: coerceNull(f.so_reference),
      payment_processing: existing?.payment_processing ?? false,
      is_backordered:
        typeof f.isBackordered === "boolean"
          ? f.isBackordered
          : existing?.is_backordered ?? null,
      giveaway:
        typeof f.giveaway === "boolean"
          ? f.giveaway
          : existing?.giveaway ?? null,
      warranty:
        typeof f.warranty === "boolean"
          ? f.warranty
          : existing?.warranty ?? null,
    };
  };

  const toLineRow = (
    r: any
  ): Database["public"]["Tables"]["invoice_lines"]["Insert"] => ({
    invoice_id: Number(r.invoice_id),
    line_no: Number(r.line_no),
    item_id: toNumOrNull(r.item_id),
    item_sku: coerceNull(r.item_sku),
    item_display_name: coerceNull(r.item_display_name),
    quantity: toNumOrNull(r.quantity),
    rate: toNumOrNull(r.rate),
    amount: toNumOrNull(r.amount),
    description: coerceNull(r.description),
    comment: coerceNull(r.comment),
  });

  const toPaymentRow = (
    r: any
  ): Database["public"]["Tables"]["invoice_payments"]["Insert"] => ({
    invoice_id: Number(r.invoice_id),
    payment_id: Number(r.payment_id),
    tran_id: coerceNull(r.tran_id),
    payment_date: normalizeUsDateToIso(coerceNull(r.payment_date)),
    amount: toNumOrNull(r.amount),
    status: coerceNull(r.status),
    payment_option: coerceNull(r.payment_option),
  });

  const chunk = <T>(arr: T[], size: number) => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  const invoiceRows: Database["public"]["Tables"]["invoices"]["Insert"][] =
    fileInvoices.map(toInvoiceRow);

  for (const batch of chunk(invoiceRows, 1000)) {
    const { error } = await supabase
      .from("invoices")
      .upsert(batch, { onConflict: "invoice_id" });
    if (error) throw error;
  }

  for (const ids of chunk(fileInvoiceIds, 1000)) {
    const { error: d1 } = await supabase
      .from("invoice_lines")
      .delete()
      .in("invoice_id", ids);
    if (d1) throw d1;
    const { error: d2 } = await supabase
      .from("invoice_payments")
      .delete()
      .in("invoice_id", ids);
    if (d2) throw d2;
  }

  if (fileLines.length) {
    const lineRows: Database["public"]["Tables"]["invoice_lines"]["Insert"][] =
      fileLines.map(toLineRow);
    for (const batch of chunk(lineRows, 1000)) {
      const { error } = await supabase
        .from("invoice_lines")
        .upsert(batch, { onConflict: "invoice_id,line_no" });
      if (error) throw error;
    }
  }

  if (filePayments.length) {
    const payRows: Database["public"]["Tables"]["invoice_payments"]["Insert"][] =
      filePayments.map(toPaymentRow);
    for (const batch of chunk(payRows, 1000)) {
      const { error } = await supabase
        .from("invoice_payments")
        .upsert(batch, { onConflict: "invoice_id,payment_id" });
      if (error) throw error;
    }
  }

  for (const ids of chunk(fileInvoiceIds, 1000)) {
    const { error } = await supabase
      .from("invoices")
      .update({
        payment_processing: false,
      } as Database["public"]["Tables"]["invoices"]["Update"])
      .in("invoice_id", ids)
      .is("payment_processing", true);
    if (error) throw error;
  }

  if (missingInFiles.length) {
    for (const ids of chunk(missingInFiles, 1000)) {
      const { error } = await supabase
        .from("invoices")
        .update({
          ns_deleted_at: nowIso,
        } as Database["public"]["Tables"]["invoices"]["Update"])
        .in("invoice_id", ids)
        .is("ns_deleted_at", null);

      if (error) throw error;
    }
  }

  return {
    upserted_invoices: invoiceRows.length,
    replaced_lines_for_invoices: fileInvoiceIds.length,
    inserted_lines: fileLines.length,
    inserted_payments: filePayments.length,
    soft_deleted_invoices: missingInFiles.length,
  };
}

export async function POST(req: NextRequest) {
  try {
    if (
      !ADMIN_SYNC_SECRET ||
      req.headers.get(ADMIN_SECRET_HEADER) !== ADMIN_SYNC_SECRET
    ) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401 }
      );
    }

    const token = await getValidToken();
    const headers = authHeaders(token);

    const manifestId =
      (await getFileIdByNameInFolder(
        headers,
        MANIFEST_NAME,
        MANIFEST_FOLDER_ID
      )) ?? null;
    if (!manifestId) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "NotFound",
          details: "manifest_latest.json not found in folder",
          folderId: MANIFEST_FOLDER_ID,
        }),
        { status: 404 }
      );
    }

    const manifestText = await restletGetLines(token, manifestId, 1000);
    const manifest = JSON.parse(stripBom(manifestText)) as ManifestShape;

    const invId = manifest?.files?.invoices?.id;
    const lnId = manifest?.files?.invoice_lines?.id;
    const payId = manifest?.files?.invoice_payments?.id;
    if (!invId || !lnId || !payId) {
      return new Response(
        JSON.stringify({ ok: false, error: "InvalidManifest" }),
        { status: 422 }
      );
    }

    const [invText, lnText, payText] = await Promise.all([
      restletGetLines(token, invId, 1000),
      restletGetLines(token, lnId, 1000),
      restletGetLines(token, payId, 1000),
    ]);

    const outDir = path.resolve(process.cwd(), "exports");
    await fs.mkdir(outDir, { recursive: true });

    const invPath = path.join(outDir, `invoices.jsonl`);
    const linesPath = path.join(outDir, `invoice_lines.jsonl`);
    const paysPath = path.join(outDir, `invoice_payments.jsonl`);

    await Promise.all([
      fs.writeFile(invPath, stripBom(invText), { encoding: "utf8" }),
      fs.writeFile(linesPath, stripBom(lnText), { encoding: "utf8" }),
      fs.writeFile(paysPath, stripBom(payText), { encoding: "utf8" }),
    ]);

    const fileInvoices = parseJsonl(invText);
    const fileLines = parseJsonl(lnText);
    const filePayments = parseJsonl(payText);

    const fileInvoiceIdsFromInvoices = Array.from(
      new Set<number>(
        fileInvoices
          .map((r: any) => Number(r.invoice_id))
          .filter((n: number) => Number.isFinite(n) && n > 0)
      )
    ).sort((a, b) => a - b);

    const fileInvoiceIdsFromLines = Array.from(
      new Set<number>(
        fileLines
          .map((r: any) => Number(r.invoice_id))
          .filter((n: number) => Number.isFinite(n) && n > 0)
      )
    );

    const fileInvoiceIdsFromPays = Array.from(
      new Set<number>(
        filePayments
          .map((r: any) => Number(r.invoice_id))
          .filter((n: number) => Number.isFinite(n) && n > 0)
      )
    );

    const fileInvoiceIds = Array.from(
      new Set<number>([
        ...fileInvoiceIdsFromInvoices,
        ...fileInvoiceIdsFromLines,
        ...fileInvoiceIdsFromPays,
      ])
    ).sort((a, b) => a - b);

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const dbActiveIds = await fetchActiveInvoiceIds(supabase);

    const existingInvoices = await fetchExistingInBatches<
      Database["public"]["Tables"]["invoices"]["Row"]
    >(
      supabase,
      "invoices",
      [
        "invoice_id",
        "tran_id",
        "trandate",
        "total",
        "tax_total",
        "amount_paid",
        "amount_remaining",
        "customer_id",
        "created_from_so_id",
        "created_from_so_tranid",
        "netsuite_url",
        "synced_at",
        "ns_deleted_at",
        "sales_rep",
        "ship_address",
        "so_reference",
        "payment_processing",
        "is_backordered",
        "giveaway",
        "warranty",
      ],
      "invoice_id",
      fileInvoiceIds
    );

    const existingLines = await fetchExistingInBatches<
      Database["public"]["Tables"]["invoice_lines"]["Row"]
    >(
      supabase,
      "invoice_lines",
      [
        "invoice_id",
        "line_no",
        "item_id",
        "item_sku",
        "item_display_name",
        "quantity",
        "rate",
        "amount",
        "description",
        "comment",
      ],
      "invoice_id",
      fileInvoiceIds
    );

    const existingPayments = await fetchExistingInBatches<
      Database["public"]["Tables"]["invoice_payments"]["Row"]
    >(
      supabase,
      "invoice_payments",
      [
        "invoice_id",
        "payment_id",
        "tran_id",
        "payment_date",
        "amount",
        "status",
        "payment_option",
      ],
      "invoice_id",
      fileInvoiceIds
    );

    const fileInvMap = new Map<number, any>();
    for (const r of fileInvoices) fileInvMap.set(Number(r.invoice_id), r);

    const dbInvMap = new Map<
      number,
      Database["public"]["Tables"]["invoices"]["Row"]
    >();
    for (const r of existingInvoices) dbInvMap.set(Number(r.invoice_id), r);

    const fileLineMap = new Map<string, any>();
    for (const r of fileLines) {
      const k = `${Number(r.invoice_id)}#${Number(r.line_no)}`;
      fileLineMap.set(k, r);
    }

    const dbLineMap = new Map<
      string,
      Database["public"]["Tables"]["invoice_lines"]["Row"]
    >();
    for (const r of existingLines) {
      const k = `${Number(r.invoice_id)}#${Number(r.line_no)}`;
      dbLineMap.set(k, r);
    }

    const filePayMap = new Map<string, any>();
    for (const r of filePayments) {
      const k = `${Number(r.invoice_id)}#${Number(r.payment_id)}`;
      filePayMap.set(k, r);
    }

    const dbPayMap = new Map<
      string,
      Database["public"]["Tables"]["invoice_payments"]["Row"]
    >();
    for (const r of existingPayments) {
      const k = `${Number(r.invoice_id)}#${Number(r.payment_id)}`;
      dbPayMap.set(k, r);
    }

    const invoiceFields = [
      "tran_id",
      "trandate",
      "total",
      "tax_total",
      "amount_paid",
      "amount_remaining",
      "customer_id",
      "created_from_so_id",
      "created_from_so_tranid",
      "netsuite_url",
      "synced_at",
      "ns_deleted_at",
      "sales_rep",
      "ship_address",
      "so_reference",
      "payment_processing",
      "is_backordered",
      "giveaway",
      "warranty",
    ];
    const invoiceNumeric = new Set([
      "total",
      "tax_total",
      "amount_paid",
      "amount_remaining",
      "customer_id",
      "created_from_so_id",
    ]);

    const lineFields = [
      "item_id",
      "item_sku",
      "item_display_name",
      "quantity",
      "rate",
      "amount",
      "description",
      "comment",
    ];
    const lineNumeric = new Set(["item_id", "quantity", "rate", "amount"]);

    const paymentFields = [
      "tran_id",
      "payment_date",
      "amount",
      "status",
      "payment_option",
    ];
    const paymentNumeric = new Set(["amount"]);

    const fileInvOnlySet = new Set<number>(fileInvoiceIdsFromInvoices);
    const dbActiveSet = new Set<number>(dbActiveIds);
    const newInvoices = fileInvoiceIdsFromInvoices.filter(
      (id) => !dbActiveSet.has(id)
    );
    const missingInFiles = dbActiveIds.filter((id) => !fileInvOnlySet.has(id));
    let missingInFilesForDelete = missingInFiles;
    if (missingInFiles.length) {
      const missingMeta = await fetchExistingInBatches<
        Pick<
          Database["public"]["Tables"]["invoices"]["Row"],
          "invoice_id" | "created_at" | "created_by"
        >
      >(
        supabase,
        "invoices",
        ["invoice_id", "created_at", "created_by"],
        "invoice_id",
        missingInFiles
      );

      const cutoffMs = Date.now() - 90 * 60 * 1000;
      const recentOcIds = new Set<number>();
      for (const r of missingMeta) {
        const createdBy = String(r.created_by ?? "").trim().toLowerCase();
        if (createdBy !== "order console") continue;
        const createdAtMs = r.created_at ? Date.parse(r.created_at) : NaN;
        if (Number.isFinite(createdAtMs) && createdAtMs >= cutoffMs) {
          recentOcIds.add(Number(r.invoice_id));
        }
      }

      if (recentOcIds.size) {
        missingInFilesForDelete = missingInFiles.filter(
          (id) => !recentOcIds.has(id)
        );
      }
    }

    const newUnpaidInvoices: Array<{
      invoice_id: number;
      customer_id: number | null;
      total: number;
      amount_remaining: number;
      tran_id: string | null;
    }> = [];

    for (const id of newInvoices) {
      const rec = fileInvMap.get(id);
      if (!rec) continue;
      const ar = Number(rec.amount_remaining ?? 0);
      const tot = Number(rec.total ?? 0);
      const cid = rec.customer_id != null ? Number(rec.customer_id) : null;
      if (ar > 0 && cid) {
        newUnpaidInvoices.push({
          invoice_id: id,
          customer_id: cid,
          total: tot,
          amount_remaining: ar,
          tran_id: rec.tran_id ?? null,
        });
      }
    }

    const supaResult = await upsertSnapshotToSupabase(
      supabase,
      fileInvoices,
      fileLines,
      filePayments,
      dbInvMap,
      fileInvoiceIds,
      missingInFilesForDelete
    );

    let emailSentCount = 0;
    if (newUnpaidInvoices.length) {
      const custIds = Array.from(
        new Set(
          newUnpaidInvoices
            .map((x) => x.customer_id)
            .filter((x): x is number => typeof x === "number")
        )
      );

      const customerInfoMap = new Map<
        number,
        { firstName: string; email: string }
      >();
      for (let i = 0; i < custIds.length; i += 50) {
        const batch = custIds.slice(i, i + 50);
        const results = await Promise.all(
          batch.map((cid) => getCustomerInfo(cid, headers))
        );
        for (let j = 0; j < batch.length; j++) {
          const info = results[j];
          if (info) customerInfoMap.set(batch[j], info);
        }
        await sleep(120);
      }

      for (const inv of newUnpaidInvoices) {
        const info = inv.customer_id
          ? customerInfoMap.get(inv.customer_id)
          : null;
        if (!info) continue;
        try {
          await sendUnpaidInvoiceNotification(
            { firstName: info.firstName, email: info.email },
            {
              invoiceId: inv.tran_id || `INV-${inv.invoice_id}`,
              total: inv.total,
              amountRemaining: inv.amount_remaining,
            }
          );
          emailSentCount++;
        } catch {}
      }
    }

    const changedInvoices: Array<{
      invoice_id: number;
      changes: Record<string, { before: any; after: any }>;
    }> = [];

    const fileInvoiceIdSet = new Set<number>(Array.from(fileInvMap.keys()));
    for (const id of fileInvoiceIdSet) {
      const f = fileInvMap.get(id);
      const d = dbInvMap.get(id);
      if (!d) continue;

      const fNorm: Record<string, any> = {
        tran_id: f.tran_id ?? null,
        trandate: f.trandate ?? null,
        total: f.total ?? null,
        tax_total: f.tax_total ?? null,
        amount_paid: f.amount_paid ?? null,
        amount_remaining: f.amount_remaining ?? null,
        customer_id: f.customer_id ?? null,
        created_from_so_id: f.created_from_so_id ?? null,
        created_from_so_tranid: f.created_from_so_tranid ?? null,
        netsuite_url: d.netsuite_url ?? null,
        synced_at: d.synced_at ?? null,
        ns_deleted_at: d.ns_deleted_at ?? null,
        sales_rep: f.sales_rep ?? null,
        ship_address: f.ship_address ?? null,
        so_reference: f.so_reference ?? null,
        payment_processing: d.payment_processing ?? null,
        is_backordered:
          typeof f.isBackordered === "boolean"
            ? f.isBackordered
            : d.is_backordered ?? null,

        giveaway: typeof f.giveaway === "boolean" ? f.giveaway : null,
        warranty: typeof f.warranty === "boolean" ? f.warranty : null,
      };

      const dNorm: Record<string, any> = {
        tran_id: d.tran_id,
        trandate: d.trandate,
        total: d.total,
        tax_total: d.tax_total,
        amount_paid: d.amount_paid,
        amount_remaining: d.amount_remaining,
        customer_id: d.customer_id,
        created_from_so_id: d.created_from_so_id,
        created_from_so_tranid: d.created_from_so_tranid,
        netsuite_url: d.netsuite_url,
        synced_at: d.synced_at,
        ns_deleted_at: d.ns_deleted_at,
        sales_rep: d.sales_rep,
        ship_address: d.ship_address,
        so_reference: d.so_reference,
        payment_processing: d.payment_processing,
        is_backordered: d.is_backordered,
        giveaway: d.giveaway ?? null,
        warranty: d.warranty ?? null,
      };

      const changes = diffObject(dNorm, fNorm, invoiceFields, invoiceNumeric);
      if (Object.keys(changes).length)
        changedInvoices.push({ invoice_id: id, changes });
    }

    const fileLineKeys = new Set(Array.from(fileLineMap.keys()));
    const dbLineKeys = new Set(Array.from(dbLineMap.keys()));
    const addedLines: string[] = [];
    const removedLines: string[] = [];
    const changedLines: Array<{
      key: string;
      invoice_id: number;
      line_no: number;
      changes: Record<string, { before: any; after: any }>;
    }> = [];

    for (const k of fileLineKeys) if (!dbLineKeys.has(k)) addedLines.push(k);
    for (const k of dbLineKeys) if (!fileLineKeys.has(k)) removedLines.push(k);
    for (const k of fileLineKeys) {
      if (!dbLineKeys.has(k)) continue;
      const f = fileLineMap.get(k);
      const d = dbLineMap.get(k);
      if (!f || !d) continue;
      const inv = Number(f.invoice_id ?? d.invoice_id);
      const ln = Number(f.line_no ?? d.line_no);
      const fNorm: Record<string, any> = {
        item_id: f.item_id ?? null,
        item_sku: f.item_sku ?? null,
        item_display_name: f.item_display_name ?? null,
        quantity: f.quantity ?? null,
        rate: f.rate ?? null,
        amount: f.amount ?? null,
        description: f.description ?? null,
        comment: f.comment ?? null,
      };
      const dNorm: Record<string, any> = {
        item_id: d.item_id,
        item_sku: d.item_sku,
        item_display_name: d.item_display_name,
        quantity: d.quantity,
        rate: d.rate,
        amount: d.amount,
        description: d.description,
        comment: d.comment,
      };
      const changes = diffObject(dNorm, fNorm, lineFields, lineNumeric);
      if (Object.keys(changes).length) {
        changedLines.push({ key: k, invoice_id: inv, line_no: ln, changes });
      }
    }

    const filePayKeys = new Set(Array.from(filePayMap.keys()));
    const dbPayKeys = new Set(Array.from(dbPayMap.keys()));
    const addedPayments: string[] = [];
    const removedPayments: string[] = [];
    const changedPayments: Array<{
      key: string;
      invoice_id: number;
      payment_id: number;
      changes: Record<string, { before: any; after: any }>;
    }> = [];

    for (const k of filePayKeys) if (!dbPayKeys.has(k)) addedPayments.push(k);
    for (const k of dbPayKeys) if (!filePayKeys.has(k)) removedPayments.push(k);
    for (const k of filePayKeys) {
      if (!dbPayKeys.has(k)) continue;
      const f = filePayMap.get(k);
      const d = dbPayMap.get(k);
      if (!f || !d) continue;
      const inv = Number(f.invoice_id ?? d.invoice_id);
      const pid = Number(f.payment_id ?? d.payment_id);
      const fNorm: Record<string, any> = {
        tran_id: f.tran_id ?? null,
        payment_date: f.payment_date ?? null,
        amount: f.amount ?? null,
        status: f.status ?? null,
        payment_option: f.payment_option ?? null,
      };
      const dNorm: Record<string, any> = {
        tran_id: d.tran_id,
        payment_date: d.payment_date,
        amount: d.amount,
        status: d.status,
        payment_option: d.payment_option,
      };
      const changes = diffObject(dNorm, fNorm, paymentFields, paymentNumeric);
      if (Object.keys(changes).length) {
        changedPayments.push({
          key: k,
          invoice_id: inv,
          payment_id: pid,
          changes,
        });
      }
    }

    const totalsCheck: Array<{
      invoice_id: number;
      total: number;
      sum_lines: number;
      delta: number;
    }> = [];
    const fileLinesByInv = new Map<number, any[]>();
    for (const r of fileLines) {
      const inv = Number(r.invoice_id);
      if (!fileLinesByInv.has(inv)) fileLinesByInv.set(inv, []);
      fileLinesByInv.get(inv)!.push(r);
    }
    for (const invId of fileInvoiceIds) {
      const finv = fileInvMap.get(invId);
      if (!finv) continue;
      const sum = (fileLinesByInv.get(invId) || []).reduce(
        (acc, r) => acc + Number(r.amount || 0),
        0
      );
      const total = Number(finv.total || 0);
      const delta = Math.abs(total - sum);
      if (delta > 0.01) {
        totalsCheck.push({
          invoice_id: invId,
          total,
          sum_lines: Number(sum.toFixed(2)),
          delta: Number(delta.toFixed(2)),
        });
      }
    }

    const balCheck: Array<{
      invoice_id: number;
      total: number;
      amount_paid: number;
      amount_remaining: number;
      delta: number;
    }> = [];
    for (const invId of fileInvoiceIds) {
      const finv = fileInvMap.get(invId);
      if (!finv) continue;
      const total = Number(finv.total || 0);
      const ap = Number(
        finv.amount_paid ?? total - Number(finv.amount_remaining || 0)
      );
      const ar = Number(finv.amount_remaining || 0);
      const delta = Math.abs(total - (ap + ar));
      if (delta > 0.01) {
        balCheck.push({
          invoice_id: invId,
          total,
          amount_paid: Number(ap.toFixed(2)),
          amount_remaining: Number(ar.toFixed(2)),
          delta: Number(delta.toFixed(2)),
        });
      }
    }

    const compareFull = {
      ok: true,
      saved_files: {
        invoices: { path: invPath, rows: fileInvoices.length },
        invoice_lines: { path: linesPath, rows: fileLines.length },
        invoice_payments: { path: paysPath, rows: filePayments.length },
      },
      compare: {
        summary: {
          invoices_in_file: fileInvoices.length,
          invoices_in_db: dbActiveIds.length,
          new_invoices: newInvoices.length,
          missing_in_files: missingInFiles.length,
          lines_in_file: fileLines.length,
          lines_in_db: existingLines.length,
          payments_in_file: filePayments.length,
          payments_in_db: existingPayments.length,
          totals_mismatch: totalsCheck.length,
          balance_mismatch: balCheck.length,
          changed_invoices: changedInvoices.length,
          added_lines: addedLines.length,
          removed_lines: removedLines.length,
          changed_lines: changedLines.length,
          added_payments: addedPayments.length,
          removed_payments: removedPayments.length,
          changed_payments: changedPayments.length,
        },
        invoices: {
          new: newInvoices,
          missingInFiles: missingInFiles,
          changed: changedInvoices,
        },
        invoice_lines: {
          added: addedLines,
          removed: removedLines,
          changed: changedLines,
        },
        invoice_payments: {
          added: addedPayments,
          removed: removedPayments,
          changed: changedPayments,
        },
        checks: {
          totals_mismatch: totalsCheck,
          balance_mismatch: balCheck,
        },
      },
    };

    return new Response(
      JSON.stringify({
        ok: true,
        manifest_generated_at: manifest.generated_at,
        saved_files: {
          invoices: { path: invPath },
          invoice_lines: { path: linesPath },
          invoice_payments: { path: paysPath },
        },
        counts: compareFull.compare.summary,
        upsert: supaResult,
        debug: {
          missing_in_files_count: missingInFiles.length,
          missing_in_files_sample: missingInFiles.slice(0, 10),
          missing_in_files_recent_oc_skipped:
            missingInFiles.length - missingInFilesForDelete.length,
        },
        email_sent: emailSentCount,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    const msg = String(err?.message || "FetchFailed");
    const status = msg.startsWith("RestletFetchFailed ")
      ? Number(msg.split(" ")[1] || 500) || 500
      : 500;
    return new Response(
      JSON.stringify({
        ok: false,
        error: msg,
        details:
          typeof err?.details === "string"
            ? err.details
            : err?.details
            ? JSON.stringify(err.details)
            : undefined,
      }),
      { status }
    );
  }
}
