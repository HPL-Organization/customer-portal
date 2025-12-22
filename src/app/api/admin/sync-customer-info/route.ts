// src/app/api/admin/sync-customer-info/route.ts
import { NextRequest } from "next/server";
import axios from "axios";
import { getValidToken } from "@/lib/netsuite/token";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

const ADMIN_SYNC_SECRET = process.env.ADMIN_SYNC_SECRET!;
const ADMIN_SECRET_HEADER = "x-admin-secret";

const EXPORT_FOLDER_ID = Number(process.env.NS_EXPORT_FOLDER_ID || 2279);
const CUSTOMER_MANIFEST_NAME = "customer_export_manifest.json";
const CUSTOMER_FILE_NAME = "customers.jsonl";

const RL_SCRIPT_ID = String(
  process.env.NS_CUSTOMER_FILE_RL_SCRIPT_ID ||
    process.env.NS_FILE_RL_SCRIPT_ID ||
    2935
);
const RL_DEPLOY_ID = String(
  process.env.NS_CUSTOMER_FILE_RL_DEPLOY_ID ||
    process.env.NS_FILE_RL_DEPLOY_ID ||
    "customdeploy1"
);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type CustomerInformationRow = {
  info_id: string;
  customer_id: number;
  email: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  phone: string | null;
  mobile: string | null;
  shipping_address1: string | null;
  shipping_address2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_zip: string | null;
  shipping_country: string | null;
  billing_address1: string | null;
  billing_address2: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_zip: string | null;
  billing_country: string | null;
  shipping_verified: boolean;
  billing_verified: boolean;
  created_at: string;
  updated_at: string;
  terms_compliance: boolean;
  terms_agreed_at: string | null;
  user_id: string | null;
  hubspot_id: number | null;
  check_invoice: boolean;
  check_invoice_range: unknown | null;
  check_invoice_result: boolean | null;
  ns_deleted_at: string | null;
};

type CustomerInformationInsert = {
  info_id?: string;
  customer_id: number;
  email?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  mobile?: string | null;
  shipping_address1?: string | null;
  shipping_address2?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_zip?: string | null;
  shipping_country?: string | null;
  billing_address1?: string | null;
  billing_address2?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_zip?: string | null;
  billing_country?: string | null;
  shipping_verified?: boolean;
  billing_verified?: boolean;
  created_at?: string;
  updated_at?: string;
  terms_compliance?: boolean;
  terms_agreed_at?: string | null;
  user_id?: string | null;
  hubspot_id?: number | null;
  check_invoice?: boolean;
  check_invoice_range?: unknown | null;
  check_invoice_result?: boolean | null;
  ns_deleted_at?: string | null;
};

type CustomerInformationUpdate = {
  info_id?: string;
  customer_id?: number;
  email?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  mobile?: string | null;
  shipping_address1?: string | null;
  shipping_address2?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_zip?: string | null;
  shipping_country?: string | null;
  billing_address1?: string | null;
  billing_address2?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_zip?: string | null;
  billing_country?: string | null;
  shipping_verified?: boolean;
  billing_verified?: boolean;
  created_at?: string;
  updated_at?: string;
  terms_compliance?: boolean;
  terms_agreed_at?: string | null;
  user_id?: string | null;
  hubspot_id?: number | null;
  check_invoice?: boolean;
  check_invoice_range?: unknown | null;
  check_invoice_result?: boolean | null;
  ns_deleted_at?: string | null;
};

type Database = {
  public: {
    Tables: {
      customer_information: {
        Row: CustomerInformationRow;
        Insert: CustomerInformationInsert;
        Update: CustomerInformationUpdate;
        Relationships: [];
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
    CompositeTypes: {};
  };
};

type CustomerRow = Database["public"]["Tables"]["customer_information"]["Row"];
type CustomerInsert = Omit<
  CustomerRow,
  "info_id" | "created_at" | "updated_at"
>;

const SELECT_EXISTING_CUSTOMERS =
  "info_id,customer_id,email,first_name,middle_name,last_name,phone,mobile,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip,shipping_country,billing_address1,billing_address2,billing_city,billing_state,billing_zip,billing_country,shipping_verified,billing_verified,terms_compliance,terms_agreed_at,user_id,hubspot_id,check_invoice,check_invoice_range,check_invoice_result,ns_deleted_at" as const;

const SELECT_ALL_MINIMAL =
  "customer_id,email,user_id,shipping_verified,billing_verified,terms_compliance,terms_agreed_at,check_invoice,check_invoice_range,check_invoice_result,ns_deleted_at" as const;

const SELECT_TARGET_USER = "customer_id,user_id" as const;

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
  const r = await netsuiteQuery(q, headers, "findFile");
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

async function* restletStreamJsonlPages(
  token: string,
  opts:
    | { id: number | string }
    | { name: string; folderId?: number }
    | { manifest: true; folderId?: number },
  pageLines = 2000
) {
  const url = restletUrl(NETSUITE_ACCOUNT_ID);
  let lineStart = 0;

  const paramsBase: Record<string, string> = {
    script: RL_SCRIPT_ID,
    deploy: RL_DEPLOY_ID,
  };
  if ("id" in opts) paramsBase.id = String(opts.id);
  else if ("name" in opts) {
    paramsBase.name = opts.name;
    if (opts.folderId) paramsBase.folderId = String(opts.folderId);
  } else {
    paramsBase.manifest = "1";
    if (opts.folderId) paramsBase.folderId = String(opts.folderId);
  }

  for (;;) {
    const r = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      params: {
        ...paramsBase,
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
    const lines = text.length ? text.split(/\r?\n/) : [];
    const page: any[] = [];
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      try {
        page.push(JSON.parse(s));
      } catch {}
    }
    if (page.length) yield page;

    const returned = Number(body.linesReturned || 0);
    if (body.done || returned < pageLines) break;
    lineStart += returned;
  }
}

async function fetchExistingCustomers(
  supabase: SupabaseClient<Database>,
  ids: number[]
): Promise<CustomerRow[]> {
  const out: CustomerRow[] = [];
  const batch = 1000;
  for (let i = 0; i < ids.length; i += batch) {
    const chunkIds = ids.slice(i, i + batch);
    const { data, error } = await supabase
      .from("customer_information")
      .select(SELECT_EXISTING_CUSTOMERS)
      .in("customer_id", chunkIds);
    if (error) throw error;
    if (data?.length) out.push(...data);
  }
  return out;
}

async function fetchAllCustomersMinimal(
  supabase: SupabaseClient<Database>
): Promise<
  Pick<
    CustomerRow,
    | "customer_id"
    | "email"
    | "user_id"
    | "shipping_verified"
    | "billing_verified"
    | "terms_compliance"
    | "terms_agreed_at"
    | "check_invoice"
    | "check_invoice_range"
    | "check_invoice_result"
    | "ns_deleted_at"
  >[]
> {
  const out: Pick<
    CustomerRow,
    | "customer_id"
    | "email"
    | "user_id"
    | "shipping_verified"
    | "billing_verified"
    | "terms_compliance"
    | "terms_agreed_at"
    | "check_invoice"
    | "check_invoice_range"
    | "check_invoice_result"
    | "ns_deleted_at"
  >[] = [];

  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("customer_information")
      .select(SELECT_ALL_MINIMAL)
      .order("customer_id", { ascending: true })
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

type Incoming = {
  customer_id: number;
  hubspot_id?: string | number | null;
  email?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  mobilephone?: string | null;
  addresses?: Array<{
    default_billing?: boolean | string;
    default_shipping?: boolean | string;
    addr1?: string | null;
    addr2?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    country?: string | null;
  }>;
};

function pickAddress(
  incoming: Incoming,
  type: "billing" | "shipping"
): {
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
} {
  const arr = incoming.addresses || [];
  const flag = type === "billing" ? "default_billing" : "default_shipping";
  let a = arr.find((x) => {
    const v = (x as any)?.[flag];
    if (typeof v === "string") return v === "T";
    return !!v;
  });
  if (!a && arr.length === 1) a = arr[0];
  return {
    address1: a?.addr1 ?? null,
    address2: a?.addr2 ?? null,
    city: a?.city ?? null,
    state: a?.state ?? null,
    zip: a?.zip ?? null,
    country: a?.country ?? null,
  };
}

function coerceStr(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function coerceBigint(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).replace(/[, ]/g, "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeEmail(v: any): string | null {
  const s = coerceStr(v);
  return s ? s.toLowerCase() : null;
}

function buildRow(inc: Incoming, existing?: CustomerRow): CustomerInsert {
  const bill = pickAddress(inc, "billing");
  const ship = pickAddress(inc, "shipping");
  return {
    customer_id: Number(inc.customer_id),
    email: coerceStr(inc.email),
    first_name: coerceStr(inc.first_name),
    middle_name: coerceStr(inc.middle_name),
    last_name: coerceStr(inc.last_name),
    phone: coerceStr(inc.phone),
    mobile: coerceStr(inc.mobilephone),
    shipping_address1: coerceStr(ship.address1),
    shipping_address2: coerceStr(ship.address2),
    shipping_city: coerceStr(ship.city),
    shipping_state: coerceStr(ship.state),
    shipping_zip: coerceStr(ship.zip),
    shipping_country: coerceStr(ship.country),
    billing_address1: coerceStr(bill.address1),
    billing_address2: coerceStr(bill.address2),
    billing_city: coerceStr(bill.city),
    billing_state: coerceStr(bill.state),
    billing_zip: coerceStr(bill.zip),
    billing_country: coerceStr(bill.country),

    shipping_verified: existing ? existing.shipping_verified : false,
    billing_verified: existing ? existing.billing_verified : false,
    terms_compliance: existing ? existing.terms_compliance : false,
    terms_agreed_at: existing ? existing.terms_agreed_at : null,
    user_id: existing ? existing.user_id : null,
    check_invoice: existing ? existing.check_invoice : false,
    check_invoice_range: existing ? existing.check_invoice_range : null,
    check_invoice_result: existing ? existing.check_invoice_result : null,

    ns_deleted_at: null,

    hubspot_id:
      inc.hubspot_id != null
        ? coerceBigint(inc.hubspot_id)
        : existing
        ? (existing as any).hubspot_id
        : null,
  };
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function safeUpsertBatch(
  supabase: SupabaseClient<Database>,
  batch: CustomerInsert[]
) {
  const { error } = await supabase
    .from("customer_information")
    .upsert(batch, { onConflict: "customer_id" });

  if (!error) return;

  const msg = String((error as any)?.message || "");
  const likelyHubspotConflict =
    msg.includes("hubspot") ||
    msg.includes("customer_information_hubspot_id_key") ||
    msg.toLowerCase().includes("duplicate key");

  if (!likelyHubspotConflict) throw error;

  for (const row of batch) {
    const { error: e1 } = await supabase
      .from("customer_information")
      .upsert(row as any, { onConflict: "customer_id" });

    if (!e1) continue;

    const m1 = String((e1 as any)?.message || "");
    const hubspotHit =
      m1.includes("hubspot") ||
      m1.includes("customer_information_hubspot_id_key") ||
      m1.toLowerCase().includes("hubspot");

    if (hubspotHit) {
      const retry: CustomerInsert = { ...row, hubspot_id: null };
      const { error: e2 } = await supabase
        .from("customer_information")
        .upsert(retry as any, { onConflict: "customer_id" });
      if (e2) throw e2;
      continue;
    }

    throw e1;
  }
}

function parseBoolParam(v: string | null): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y" || s === "on";
}

type DeleteRowLog = {
  customer_id: number;
  email: string | null;
  user_id: string | null;
  ns_deleted_at?: string | null;
  reason:
    | "missing_from_stream_no_user_id"
    | "missing_from_stream_with_user_id"
    | "multiple_ns_candidates"
    | "target_missing_or_user_conflict"
    | "move_user_link_and_delete_old";
  details?: any;
};

function emailIsHpl(email: string | null): boolean {
  const e = (email || "").trim().toLowerCase();
  return e.endsWith("@hplapidary.com");
}

function logArrayMaybe(tag: string, arr: any[], max = 500) {
  if (arr.length <= max) console.log(tag, arr);
  else console.log(tag, { total: arr.length, sample: arr.slice(0, max) });
}

export async function POST(req: NextRequest) {
  try {
    if (
      !ADMIN_SYNC_SECRET ||
      req.headers.get(ADMIN_SECRET_HEADER) !== ADMIN_SYNC_SECRET
    ) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        {
          status: 401,
        }
      );
    }

    const sp = req.nextUrl.searchParams;
    const dryRun = parseBoolParam(sp.get("dry"));
    const previewLimitRaw = sp.get("preview");
    const previewLimit = Math.min(
      200,
      Math.max(0, Number(previewLimitRaw ?? "25") || 25)
    );

    const token = await getValidToken();
    const headers = authHeaders(token);

    let fileId: number | null = null;
    const manifestId =
      (await getFileIdByNameInFolder(
        headers,
        CUSTOMER_MANIFEST_NAME,
        EXPORT_FOLDER_ID
      )) ?? null;

    if (manifestId) {
      const url = restletUrl(NETSUITE_ACCOUNT_ID);
      const r = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        params: {
          script: RL_SCRIPT_ID,
          deploy: RL_DEPLOY_ID,
          id: String(manifestId),
          lineStart: "0",
          maxLines: "1000",
        },
        transformResponse: (x) => x,
        validateStatus: () => true,
      });
      const body = asJson(r.data);
      if (!body?.ok) throw new Error("RestletFetchFailed 400");
      const parsed = JSON.parse(stripBom(String(body.data || "")));
      const maybeId = Number(parsed?.file?.id);
      fileId = Number.isFinite(maybeId) && maybeId > 0 ? maybeId : null;
    }

    const sourceOpts =
      fileId != null
        ? ({ id: fileId } as const)
        : ({ name: CUSTOMER_FILE_NAME, folderId: EXPORT_FOLDER_ID } as const);

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let total = 0;
    let inserted = 0;
    let updated = 0;

    let moved_user_links = 0;
    let soft_deleted = 0;
    let hard_deleted = 0;
    let ambiguous_skipped = 0;

    const preview: any[] = [];

    const hard_delete_rows: DeleteRowLog[] = [];
    const soft_delete_rows: DeleteRowLog[] = [];
    const ambiguous_rows: DeleteRowLog[] = [];
    const risky_soft_deletes_hpl: DeleteRowLog[] = [];

    const seenIds = new Set<number>();
    const emailToNsIds = new Map<string, Set<number>>();

    for await (const page of restletStreamJsonlPages(token, sourceOpts, 2000)) {
      total += page.length;

      const ids = page
        .map((r: any) => Number(r.customer_id))
        .filter((n: number) => Number.isFinite(n) && n > 0);

      for (const id of ids) seenIds.add(id);

      for (const r of page as Incoming[]) {
        const id = Number(r.customer_id);
        if (!Number.isFinite(id) || id <= 0) continue;
        const e = normalizeEmail(r.email);
        if (!e) continue;
        const set = emailToNsIds.get(e) ?? new Set<number>();
        set.add(id);
        emailToNsIds.set(e, set);
      }

      const existingRows = await fetchExistingCustomers(supabase, ids);
      const existingMap = new Map<number, CustomerRow>();
      for (const row of existingRows)
        existingMap.set(Number(row.customer_id), row);

      const upserts: CustomerInsert[] = (page as Incoming[]).map((inc) =>
        buildRow(inc, existingMap.get(Number(inc.customer_id)))
      );

      for (const b of chunk(upserts, 1000)) {
        const existed = b.filter((x) =>
          existingMap.has(Number(x.customer_id || 0))
        ).length;
        updated += existed;
        inserted += b.length - existed;

        if (!dryRun) {
          await safeUpsertBatch(supabase, b);
        } else if (preview.length < previewLimit) {
          preview.push({
            type: "upsert_batch",
            size: b.length,
            inserted: b.length - existed,
            updated: existed,
          });
        }
      }
    }

    const all = await fetchAllCustomersMinimal(supabase);
    const missing = all.filter((r) => {
      const id = Number(r.customer_id);
      if (id === -1) return false;
      return !seenIds.has(id);
    });
    const nowIso = new Date().toISOString();

    for (const row of missing) {
      const customerId = Number(row.customer_id);
      const userId = row.user_id ? String(row.user_id) : null;
      const emailNorm = normalizeEmail(row.email);

      if (!userId) {
        hard_delete_rows.push({
          customer_id: customerId,
          email: row.email ?? null,
          user_id: null,
          reason: "missing_from_stream_no_user_id",
        });

        if (dryRun) {
          hard_deleted++;
          if (preview.length < previewLimit) {
            preview.push({
              type: "hard_delete_no_user",
              reason: "missing_from_stream_no_user_id",
              customer_id: customerId,
              email: row.email ?? null,
            });
          }
        } else {
          const { error } = await supabase
            .from("customer_information")
            .delete()
            .eq("customer_id", customerId);
          if (error) throw error;
          hard_deleted++;
        }
        continue;
      }

      if (emailNorm) {
        const candidates = emailToNsIds.get(emailNorm);

        if (candidates && candidates.size === 1) {
          const targetCustomerId = Array.from(candidates)[0];

          const { data: targetRows, error: targetErr } = await supabase
            .from("customer_information")
            .select(SELECT_TARGET_USER)
            .eq("customer_id", targetCustomerId)
            .limit(1);

          if (targetErr) throw targetErr;

          const target = targetRows?.[0] ?? null;
          const targetUserId = target?.user_id ? String(target.user_id) : null;

          if (target && (targetUserId == null || targetUserId === userId)) {
            hard_delete_rows.push({
              customer_id: customerId,
              email: row.email ?? null,
              user_id: userId,
              reason: "move_user_link_and_delete_old",
              details: { to_customer_id: targetCustomerId },
            });

            if (dryRun) {
              moved_user_links++;
              hard_deleted++;
              if (preview.length < previewLimit) {
                preview.push({
                  type: "move_user_link_and_delete_old",
                  reason: "move_user_link_and_delete_old",
                  from_customer_id: customerId,
                  to_customer_id: targetCustomerId,
                  user_id: userId,
                  moved_fields: [
                    "user_id",
                    "terms_compliance",
                    "terms_agreed_at",
                    "shipping_verified",
                    "billing_verified",
                    "check_invoice",
                    "check_invoice_range",
                    "check_invoice_result",
                    "ns_deleted_at(null)",
                  ],
                });
              }
            } else {
              const detach: CustomerInformationUpdate = { user_id: null };
              const { error: e1 } = await supabase
                .from("customer_information")
                .update(detach)
                .eq("customer_id", customerId)
                .eq("user_id", userId);
              if (f1(e1)) throw e1;

              const move: CustomerInformationUpdate = {
                user_id: userId,
                terms_compliance: row.terms_compliance ?? false,
                terms_agreed_at: row.terms_agreed_at ?? null,
                shipping_verified: row.shipping_verified ?? false,
                billing_verified: row.billing_verified ?? false,
                check_invoice: row.check_invoice ?? false,
                check_invoice_range: row.check_invoice_range ?? null,
                check_invoice_result: row.check_invoice_result ?? null,
                ns_deleted_at: null,
              };

              const { error: e2 } = await supabase
                .from("customer_information")
                .update(move)
                .eq("customer_id", targetCustomerId);

              if (e2) {
                const undo: CustomerInformationUpdate = { user_id: userId };
                await supabase
                  .from("customer_information")
                  .update(undo)
                  .eq("customer_id", customerId)
                  .is("user_id", null);
                throw e2;
              }

              const { error: e3 } = await supabase
                .from("customer_information")
                .delete()
                .eq("customer_id", customerId)
                .is("user_id", null);
              if (e3) throw e3;

              moved_user_links++;
              hard_deleted++;
            }
            continue;
          }

          ambiguous_skipped++;
          const amb: DeleteRowLog = {
            customer_id: customerId,
            email: row.email ?? null,
            user_id: userId,
            ns_deleted_at: nowIso,
            reason: "target_missing_or_user_conflict",
            details: {
              target_customer_id: targetCustomerId,
              target_user_id: targetUserId,
            },
          };
          ambiguous_rows.push(amb);
          soft_delete_rows.push(amb);
          if (emailIsHpl(amb.email)) risky_soft_deletes_hpl.push(amb);

          if (dryRun) {
            soft_deleted++;
            if (preview.length < previewLimit) {
              preview.push({
                type: "ambiguous_target_user_conflict_soft_delete",
                reason: "target_missing_or_user_conflict",
                customer_id: customerId,
                email: row.email ?? null,
                user_id: userId,
                target_customer_id: targetCustomerId,
                target_user_id: targetUserId,
                ns_deleted_at: nowIso,
              });
            }
          } else {
            const soft: CustomerInformationUpdate = { ns_deleted_at: nowIso };
            const { error: e4 } = await supabase
              .from("customer_information")
              .update(soft)
              .eq("customer_id", customerId);
            if (e4) throw e4;
            soft_deleted++;
          }
          continue;
        }
      }

      let softReason: DeleteRowLog["reason"] =
        "missing_from_stream_with_user_id";
      let softDetails: any = undefined;

      if (emailNorm) {
        const candidates = emailToNsIds.get(emailNorm);
        if (candidates && candidates.size > 1) {
          ambiguous_skipped++;
          softReason = "multiple_ns_candidates";
          softDetails = {
            candidate_count: candidates.size,
            candidate_customer_ids: Array.from(candidates).slice(0, 200),
          };

          const amb: DeleteRowLog = {
            customer_id: customerId,
            email: row.email ?? null,
            user_id: userId,
            ns_deleted_at: nowIso,
            reason: "multiple_ns_candidates",
            details: softDetails,
          };
          ambiguous_rows.push(amb);
          if (dryRun && preview.length < previewLimit) {
            preview.push({
              type: "ambiguous_multiple_ns_candidates",
              reason: "multiple_ns_candidates",
              customer_id: customerId,
              email: row.email ?? null,
              user_id: userId,
              candidate_customer_ids: Array.from(candidates).slice(0, 20),
              candidate_count: candidates.size,
              action: "soft_delete",
              ns_deleted_at: nowIso,
            });
          }
        }
      }

      const softLog: DeleteRowLog = {
        customer_id: customerId,
        email: row.email ?? null,
        user_id: userId,
        ns_deleted_at: nowIso,
        reason: softReason,
        details: softDetails,
      };
      soft_delete_rows.push(softLog);
      if (emailIsHpl(softLog.email)) risky_soft_deletes_hpl.push(softLog);

      if (dryRun) {
        soft_deleted++;
        if (preview.length < previewLimit) {
          preview.push({
            type: "soft_delete_missing_from_stream",
            reason: softReason,
            customer_id: customerId,
            email: row.email ?? null,
            user_id: userId,
            ns_deleted_at: nowIso,
          });
        }
      } else {
        const soft: CustomerInformationUpdate = { ns_deleted_at: nowIso };
        const { error } = await supabase
          .from("customer_information")
          .update(soft)
          .eq("customer_id", customerId);
        if (error) throw error;
        soft_deleted++;
      }
    }

    const result = {
      ok: true,
      dry_run: dryRun,
      counts: {
        customers_processed: total,
        inserted,
        updated,
        moved_user_links,
        soft_deleted,
        hard_deleted,
        ambiguous_skipped,
        missing_in_supabase_not_in_stream: missing.length,
        seen_ids_in_stream: seenIds.size,
      },
      deletions: {
        hard: hard_delete_rows,
        soft: soft_delete_rows,
        ambiguous: ambiguous_rows,
        risky_soft_deletes_hpl,
      },
      preview,
    };

    console.log(
      `[sync-customer-info] ${dryRun ? "DRY RUN" : "LIVE"} counts=`,
      result.counts
    );
    console.log(
      `[sync-customer-info] deletions hard=${hard_delete_rows.length} soft=${soft_delete_rows.length} ambiguous=${ambiguous_rows.length} risky_hpl_soft=${risky_soft_deletes_hpl.length}`
    );

    if (dryRun) {
      logArrayMaybe("[sync-customer-info] hard_delete_rows=", hard_delete_rows);
      logArrayMaybe("[sync-customer-info] soft_delete_rows=", soft_delete_rows);
      logArrayMaybe("[sync-customer-info] ambiguous_rows=", ambiguous_rows);
      logArrayMaybe(
        "[sync-customer-info] risky_soft_deletes_hpl=",
        risky_soft_deletes_hpl
      );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    const msg = String(err?.message || "SyncFailed");
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

function f1(e: any) {
  return !!e;
}
