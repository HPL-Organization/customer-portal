import { NextRequest } from "next/server";
import axios from "axios";
import { getValidToken } from "@/lib/netsuite/token";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

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

type Database = {
  public: {
    Tables: {
      customer_information: {
        Row: {
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
        };
        Insert: Partial<
          Database["public"]["Tables"]["customer_information"]["Row"]
        >;
        Update: Partial<
          Database["public"]["Tables"]["customer_information"]["Row"]
        >;
      };
    };
  };
};

type CustomerRow = Database["public"]["Tables"]["customer_information"]["Row"];
type CustomerInsert = Omit<
  CustomerRow,
  "info_id" | "created_at" | "updated_at"
>;

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
    const chunk = ids.slice(i, i + batch);
    const { data, error } = await supabase
      .from("customer_information")
      .select(
        [
          "info_id",
          "customer_id",
          "email",
          "first_name",
          "middle_name",
          "last_name",
          "phone",
          "mobile",
          "shipping_address1",
          "shipping_address2",
          "shipping_city",
          "shipping_state",
          "shipping_zip",
          "shipping_country",
          "billing_address1",
          "billing_address2",
          "billing_city",
          "billing_state",
          "billing_zip",
          "billing_country",
          "shipping_verified",
          "billing_verified",
          "terms_compliance",
          "terms_agreed_at",
          "user_id",
        ].join(",")
      )
      .in("customer_id", chunk);
    if (error) throw error;
    if (data?.length) out.push(...(data as CustomerRow[]));
  }
  return out;
}

type Incoming = {
  customer_id: number;
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

// Always return string|null (no undefined)
function coerceStr(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
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
    // preserve portal-controlled fields on update
    shipping_verified: existing ? existing.shipping_verified : false,
    billing_verified: existing ? existing.billing_verified : false,
    terms_compliance: existing ? existing.terms_compliance : false,
    terms_agreed_at: existing ? existing.terms_agreed_at : null,
    user_id: existing ? existing.user_id : null,
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

    for await (const page of restletStreamJsonlPages(token, sourceOpts, 2000)) {
      total += page.length;

      const ids = page
        .map((r: any) => Number(r.customer_id))
        .filter((n: number) => Number.isFinite(n) && n > 0);

      const existingRows = await fetchExistingCustomers(supabase, ids);
      const existingMap = new Map<number, CustomerRow>();
      for (const row of existingRows)
        existingMap.set(Number(row.customer_id), row);

      const upserts: CustomerInsert[] = page.map((inc: Incoming) =>
        buildRow(inc, existingMap.get(Number(inc.customer_id)))
      );

      const chunk = <T>(arr: T[], size: number) => {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += size)
          out.push(arr.slice(i, i + size));
        return out;
      };

      for (const batch of chunk(upserts, 1000)) {
        const { error } = await supabase
          .from("customer_information")
          .upsert(batch as any, { onConflict: "customer_id" });
        if (error) throw error;

        const existed = batch.filter((b) =>
          existingMap.has(Number(b.customer_id || 0))
        ).length;
        updated += existed;
        inserted += batch.length - existed;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        counts: { customers_processed: total, inserted, updated },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
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
