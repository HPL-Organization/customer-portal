import { NextRequest } from "next/server";
import axios from "axios";
import { getValidToken } from "@/lib/netsuite/token";
import { createClient } from "@supabase/supabase-js";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

const ADMIN_SYNC_SECRET = process.env.ADMIN_SYNC_SECRET!;
const ADMIN_SECRET_HEADER = "x-admin-secret";

const MANIFEST_FOLDER_ID = Number(process.env.NS_EXPORT_FOLDER_ID || 2279);
const SO_MANIFEST_NAME = "sales_orders_manifest_latest.json";

const RL_SCRIPT_ID = 2935;
const RL_DEPLOY_ID = "customdeploy1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type SoManifestShape = {
  generated_at: string;
  tag: string;
  files: {
    sales_orders: { id: string | number; name: string; rows: number };
    sales_order_lines: { id: string | number; name: string; rows: number };
  };
};

type SalesOrdersRow = {
  so_id: number | null;
  tran_id: string | null;
  trandate: string | null;
  total: number | null;
  tax_total: number | null;
  customer_id: number;
  netsuite_url: string | null;
  sales_rep: string | null;
  ship_address: string | null;
  so_reference: string | null;
  hubspot_so_id: string | null;
  sales_channel_id: string | null;
  affiliate_id: string | null;
  synced_at: string;
  ns_deleted_at: string | null;
  managed_by_console: boolean;
  processing_state: string;
  processing_job_id: string | null;
  processing_started_at: string | null;
  last_callback_at: string | null;
  last_callback_status: string | null;
  last_error: string | null;
  lines_stale: boolean;
  so_supabase_id: string;
  order_note: string | null;
  ship_complete: boolean | null;
  billing_terms_id: string | null;
  sales_team: any | null;
  partners: any | null;
  giveaway: boolean | null;
  warranty: boolean | null;
};

type SalesOrderLinesRow = {
  so_id: number;
  line_no: number;
  item_id: number | null;
  item_sku: string | null;
  item_display_name: string | null;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
  description: string | null;
  comment: string | null;
  is_closed: boolean;
  fulfillment_status: string | null;
  ns_line_id: number | null;
};

type Database = {
  public: {
    Tables: {
      sales_orders: {
        Row: SalesOrdersRow;
        Insert: Partial<SalesOrdersRow>;
        Update: Partial<SalesOrdersRow>;
        Relationships: [];
      };
      sales_order_lines: {
        Row: SalesOrderLinesRow;
        Insert: Partial<SalesOrderLinesRow>;
        Update: Partial<SalesOrderLinesRow>;
        Relationships: [];
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
    CompositeTypes: {};
  };
};

type SalesOrderInsert = Database["public"]["Tables"]["sales_orders"]["Insert"];
type SalesOrderLineInsert =
  Database["public"]["Tables"]["sales_order_lines"]["Insert"];

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
  const r = await netsuiteQuery(q, headers, "findSoManifest");
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

function coerceText(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function toNumOrNull(v: any): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseBool(v: any): boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toUpperCase();
  if (s === "T" || s === "TRUE" || s === "Y") return true;
  if (s === "F" || s === "FALSE" || s === "N") return false;
  return null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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
        SO_MANIFEST_NAME,
        MANIFEST_FOLDER_ID
      )) ?? null;

    if (!manifestId) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "NotFound",
          details: `${SO_MANIFEST_NAME} not found in folder`,
          folderId: MANIFEST_FOLDER_ID,
        }),
        { status: 404 }
      );
    }

    const manifestText = await restletGetLines(token, manifestId, 1000);
    const manifest = JSON.parse(stripBom(manifestText)) as SoManifestShape;

    const soId = manifest?.files?.sales_orders?.id;
    const soLinesId = manifest?.files?.sales_order_lines?.id;

    if (!soId || !soLinesId) {
      return new Response(
        JSON.stringify({ ok: false, error: "InvalidManifest" }),
        { status: 422 }
      );
    }

    const [soText, soLinesText] = await Promise.all([
      restletGetLines(token, soId, 1000),
      restletGetLines(token, soLinesId, 1000),
    ]);

    const salesOrdersRaw = parseJsonl(soText);
    const salesOrderLinesRaw = parseJsonl(soLinesText);

    const fileSoIds = Array.from(
      new Set<number>(
        salesOrdersRaw
          .map((r: any) => Number(r.so_id))
          .filter((n: number) => Number.isFinite(n) && n > 0)
      )
    );

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const headerRows: SalesOrderInsert[] = salesOrdersRaw
      .map((r: any) => {
        const so_id = Number(r.so_id);
        const customer_id =
          r.customer_id != null ? Number(r.customer_id) : null;
        if (!Number.isFinite(so_id) || !customer_id) return null;

        return {
          so_id,
          tran_id: coerceText(r.tran_id),
          trandate: normalizeUsDateToIso(r.trandate),
          total: toNumOrNull(r.total),
          tax_total: toNumOrNull(r.tax_total),
          customer_id,
          netsuite_url: null,
          sales_rep: coerceText(r.sales_rep),
          ship_address: coerceText(r.ship_address),
          so_reference: coerceText(r.so_reference),
          hubspot_so_id: coerceText(r.hubspot_so_id),
          sales_channel_id: coerceText(r.sales_channel_id),
          affiliate_id: coerceText(r.affiliate_id),
          order_note: coerceText(r.order_note),
          ship_complete: parseBool(r.ship_complete),
          billing_terms_id: coerceText(r.billing_terms_id),
          sales_team: Array.isArray(r.sales_team) ? r.sales_team : null,
          partners: Array.isArray(r.partners) ? r.partners : null,
          giveaway: parseBool(r.giveaway ?? r.custbody_hpl_giveaway),
          warranty: parseBool(r.warranty ?? r.custbody_hpl_warranty),
          ns_deleted_at: null,
        } as SalesOrderInsert;
      })
      .filter((x): x is SalesOrderInsert => !!x);

    for (const batch of chunk(headerRows, 1000)) {
      const { error } = await supabase
        .from("sales_orders")
        .upsert(batch, { onConflict: "so_id" });
      if (error) throw error;
    }

    const { data: activeRows, error: activeErr } = await supabase
      .from("sales_orders")
      .select("so_id, ns_deleted_at")
      .is("ns_deleted_at", null);

    if (activeErr) throw activeErr;

    const activeSoIds = (activeRows || [])
      .map((r) => r.so_id)
      .filter((n): n is number => typeof n === "number");

    const fileSoIdSet = new Set(fileSoIds);
    const missingInFiles = activeSoIds.filter((id) => !fileSoIdSet.has(id));

    const nowIso = new Date().toISOString();
    for (const ids of chunk(missingInFiles, 1000)) {
      const { error } = await supabase
        .from("sales_orders")
        .update({ ns_deleted_at: nowIso })
        .in("so_id", ids)
        .is("ns_deleted_at", null);
      if (error) throw error;
    }

    const lineRows: SalesOrderLineInsert[] = salesOrderLinesRaw
      .map((r: any) => {
        const so_id = Number(r.so_id);
        const line_no = Number(
          r.line_no ?? r.linesequencenumber ?? r.lineNo ?? 0
        );
        if (!Number.isFinite(so_id) || !Number.isFinite(line_no)) return null;

        return {
          so_id,
          line_no,
          item_id: toNumOrNull(r.item_id),
          item_sku: coerceText(r.item_sku),
          item_display_name: coerceText(
            r.item_display_name ?? r.displayname ?? r.sku
          ),
          quantity: toNumOrNull(r.quantity),
          rate: toNumOrNull(r.rate),
          amount: toNumOrNull(r.amount),
          description: coerceText(r.description),
          comment: coerceText(r.comment),
          is_closed: Boolean(r.is_closed),
          fulfillment_status: coerceText(r.fulfillment_status),
          ns_line_id: toNumOrNull(r.ns_line_id),
        } as SalesOrderLineInsert;
      })
      .filter((x): x is SalesOrderLineInsert => !!x);

    if (fileSoIds.length) {
      for (const ids of chunk(fileSoIds, 1000)) {
        const { error } = await supabase
          .from("sales_order_lines")
          .delete()
          .in("so_id", ids);
        if (error) throw error;
      }
    }

    if (lineRows.length) {
      for (const batch of chunk(lineRows, 1000)) {
        const { error } = await supabase
          .from("sales_order_lines")
          .insert(batch);
        if (error) throw error;
      }
    }

    return new Response(
      JSON.stringify(
        {
          ok: true,
          manifest_generated_at: manifest.generated_at,
          files: {
            sales_orders: {
              file_id: soId,
              rows_reported: manifest.files.sales_orders.rows,
              rows_parsed: salesOrdersRaw.length,
            },
            sales_order_lines: {
              file_id: soLinesId,
              rows_reported: manifest.files.sales_order_lines.rows,
              rows_parsed: salesOrderLinesRaw.length,
            },
          },
          counts: {
            headers_upserted: headerRows.length,
            lines_inserted: lineRows.length,
            soft_deleted: missingInFiles.length,
          },
        },
        null,
        2
      ),
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
