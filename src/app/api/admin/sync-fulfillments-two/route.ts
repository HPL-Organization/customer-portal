// app/api/admin/sync-fulfillments-two/route.ts
import { NextRequest } from "next/server";
import axios from "axios";
import { getValidToken } from "@/lib/netsuite/token";
import fs from "node:fs/promises";
import path from "node:path";
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

const MANIFEST_FOLDER_ID = Number(process.env.NS_EXPORT_FOLDER_ID || 2279);
const MANIFEST_NAME = "manifest_fulfillments_latest.json";

const RL_SCRIPT_ID = 2935;
const RL_DEPLOY_ID = "customdeploy1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type ManifestPart = { id: string | number; name: string; rows: number };
type ManifestShape = {
  generated_at: string;
  folder_id?: number;
  notes?: any;
  files: {
    fulfillments:
      | { id: string | number; name: string; rows: number }
      | { total_rows: number; parts: ManifestPart[] };
    fulfillment_lines:
      | { id: string | number; name: string; rows: number }
      | { total_rows: number; parts: ManifestPart[] };
  };
};

type Database = {
  public: {
    Tables: {
      fulfillments: {
        Row: {
          fulfillment_id: number;
          tran_id: string | null;
          trandate: string | null;
          customer_id: number;
          ship_status: string | null;
          status: string | null;
          created_from_so_id: number | null;
          created_from_so_tranid: string | null;
          tracking: string | null;
          tracking_urls: string[] | null;
          tracking_details: any | null;
          synced_at: string | null;
          last_modified: string | null;
          ns_deleted_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["fulfillments"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["fulfillments"]["Row"]>;
        Relationships: [];
      };
      fulfillment_lines: {
        Row: {
          fulfillment_id: number;
          line_no: number;
          item_id: number | null;
          item_sku: string | null;
          item_display_name: string | null;
          quantity: number | null;
          serial_numbers: string[] | null;
          comments: string[] | null;
          line_id: number | null;
        };
        Insert: Partial<
          Database["public"]["Tables"]["fulfillment_lines"]["Row"]
        >;
        Update: Partial<
          Database["public"]["Tables"]["fulfillment_lines"]["Row"]
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

  const delays = [500, 1000, 2000, 4000, 8000];
  const MAX_WAIT_MS = 120000;

  for (;;) {
    let attempt = 0;

    for (;;) {
      const r = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
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

      const rawText =
        typeof r.data === "string" ? r.data : JSON.stringify(r.data);
      const body = asJson(r.data);

      const isReqLimit =
        rawText.includes("SSS_REQUEST_LIMIT_EXCEEDED") ||
        rawText.includes("Request Limit Exceeded");

      const isConcurrency =
        rawText.includes("CONCURRENCY_LIMIT_EXCEEDED") ||
        rawText.includes("SSS_CONCURRENCY_LIMIT_EXCEEDED");

      if (r.status === 429 || r.status === 503 || isReqLimit || isConcurrency) {
        const backoff = delays[Math.min(attempt, delays.length - 1)];
        await sleep(Math.min(Math.max(backoff, 250), MAX_WAIT_MS));
        attempt++;
        continue;
      }

      if (r.status < 200 || r.status >= 300 || !body || !body.ok) {
        const e = new Error(`RestletFetchFailed ${r.status}`);
        (e as any).details = rawText;
        throw e;
      }

      const text = stripBom(String(body.data || ""));
      if (text.length) {
        if (out.length) out += "\n";
        out += text;
      }

      const returned = Number(body.linesReturned || 0);
      if (body.done || returned < pageLines) return out;

      lineStart += returned;
      break; // move to next page for this fileId
    }
  }
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

function normalizeDateToIso(d: any): string | null {
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

function getManifestParts(
  obj:
    | { id: string | number; name: string; rows: number }
    | { total_rows: number; parts: ManifestPart[] }
    | any
): ManifestPart[] {
  if (!obj) return [];
  if (Array.isArray(obj.parts)) return obj.parts as ManifestPart[];
  if (obj.id) {
    return [
      {
        id: obj.id,
        name: String(obj.name || "unknown.jsonl"),
        rows: Number(obj.rows || 0),
      },
    ];
  }
  return [];
}

async function restletGetLinesForParts(
  token: string,
  parts: ManifestPart[],
  pageLines = 1000
) {
  let out = "";
  for (const p of parts) {
    const txt = await restletGetLines(token, p.id, pageLines);
    if (txt.length) {
      if (out.length) out += "\n";
      out += txt;
    }
  }
  return out;
}

async function fetchActiveFulfillmentIds(
  supabase: SupabaseClient<Database>
): Promise<number[]> {
  const out: number[] = [];
  let from = 0;
  const page = 1000;

  for (;;) {
    const { data, error } = await supabase
      .from("fulfillments")
      .select("fulfillment_id")
      .is("ns_deleted_at", null)
      .order("fulfillment_id", { ascending: true })
      .range(from, from + page - 1);

    if (error) throw error;
    if (!data?.length) break;

    for (const r of data) out.push(Number((r as any).fulfillment_id));

    if (data.length < page) break;
    from += page;
  }
  return out;
}

async function fetchExistingFulfillmentsInBatches(
  supabase: SupabaseClient<Database>,
  ids: number[]
): Promise<Database["public"]["Tables"]["fulfillments"]["Row"][]> {
  const out: Database["public"]["Tables"]["fulfillments"]["Row"][] = [];
  const batch = 1000;

  for (let i = 0; i < ids.length; i += batch) {
    const slice = ids.slice(i, i + batch);
    const { data, error } = await supabase
      .from("fulfillments")
      .select(
        [
          "fulfillment_id",
          "tran_id",
          "trandate",
          "customer_id",
          "ship_status",
          "status",
          "created_from_so_id",
          "created_from_so_tranid",
          "tracking",
          "tracking_urls",
          "tracking_details",
          "synced_at",
          "last_modified",
          "ns_deleted_at",
        ].join(",")
      )
      .in("fulfillment_id", slice);

    if (error) throw error;
    if (data?.length) out.push(...(data as any));
  }

  return out;
}

async function upsertFulfillmentSnapshotToSupabase(
  supabase: SupabaseClient<Database>,
  fileFulfillments: any[],
  fileLines: any[],
  dbMap: Map<number, Database["public"]["Tables"]["fulfillments"]["Row"]>,
  fileFulfillmentIdsUnion: number[],
  missingInFiles: number[]
) {
  const nowIso = new Date().toISOString();

  let skippedMissingCustomer = 0;

  const validFulfillmentIdSet = new Set<number>();

  const fulfillmentRows: Database["public"]["Tables"]["fulfillments"]["Insert"][] =
    [];

  for (const f of fileFulfillments) {
    const fid = Number(f.fulfillment_id);
    if (!Number.isFinite(fid) || fid <= 0) continue;

    const customerId = toNumOrNull(f.customer_id);
    if (!customerId || customerId <= 0) {
      skippedMissingCustomer++;
      continue;
    }

    const existing = dbMap.get(fid);

    fulfillmentRows.push({
      fulfillment_id: fid,
      tran_id: coerceNull(f.tran_id),
      trandate: normalizeDateToIso(coerceNull(f.trandate)),
      customer_id: customerId,
      ship_status: coerceNull(f.ship_status),
      status: coerceNull(f.status),
      created_from_so_id: toNumOrNull(f.created_from_so_id),
      created_from_so_tranid: coerceNull(f.created_from_so_tranid),
      tracking: coerceNull(f.tracking),
      tracking_urls: Array.isArray(f.tracking_urls)
        ? (f.tracking_urls as any[]).map((x) => String(x))
        : null,
      tracking_details:
        f.tracking_details && typeof f.tracking_details === "object"
          ? f.tracking_details
          : null,
      synced_at: nowIso,
      last_modified: coerceNull(existing?.last_modified) ?? null,
      ns_deleted_at: null,
    });

    validFulfillmentIdSet.add(fid);
  }

  const chunk = <T>(arr: T[], size: number) => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  for (const batch of chunk(fulfillmentRows, 1000)) {
    const { error } = await supabase
      .from("fulfillments")
      .upsert(batch, { onConflict: "fulfillment_id" });
    if (error) throw error;
  }

  const validFulfillmentIds = fileFulfillmentIdsUnion.filter((id) =>
    validFulfillmentIdSet.has(id)
  );

  for (const ids of chunk(validFulfillmentIds, 1000)) {
    const { error } = await supabase
      .from("fulfillment_lines")
      .delete()
      .in("fulfillment_id", ids);
    if (error) throw error;
  }

  const lineRows: Database["public"]["Tables"]["fulfillment_lines"]["Insert"][] =
    [];

  for (const r of fileLines) {
    const fid = Number(r.fulfillment_id);
    if (!Number.isFinite(fid) || fid <= 0) continue;
    if (!validFulfillmentIdSet.has(fid)) continue;

    const lineNo = Number(r.line_no);
    if (!Number.isFinite(lineNo)) continue;

    lineRows.push({
      fulfillment_id: fid,
      line_no: lineNo,
      item_id: toNumOrNull(r.item_id),
      item_sku: coerceNull(r.item_sku),
      item_display_name: coerceNull(r.item_display_name),
      quantity: toNumOrNull(r.quantity),
      serial_numbers: Array.isArray(r.serial_numbers)
        ? (r.serial_numbers as any[]).map((x) => String(x))
        : null,
      comments: Array.isArray(r.comments)
        ? (r.comments as any[]).map((x) => String(x))
        : null,
      line_id: toNumOrNull(r.line_id),
    });
  }

  for (const batch of chunk(lineRows, 1000)) {
    const { error } = await supabase
      .from("fulfillment_lines")
      .upsert(batch, { onConflict: "fulfillment_id,line_no" });
    if (error) throw error;
  }

  if (missingInFiles.length) {
    for (const ids of chunk(missingInFiles, 1000)) {
      const { error } = await supabase
        .from("fulfillments")
        .update({
          ns_deleted_at: nowIso,
          synced_at: nowIso,
        } as Database["public"]["Tables"]["fulfillments"]["Update"])
        .in("fulfillment_id", ids)
        .is("ns_deleted_at", null);

      if (error) throw error;
    }
  }

  return {
    upserted_fulfillments: fulfillmentRows.length,
    replaced_lines_for_fulfillments: validFulfillmentIds.length,
    inserted_lines: lineRows.length,
    soft_deleted_fulfillments: missingInFiles.length,
    skipped_missing_customer_id: skippedMissingCustomer,
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
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
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
          details: `${MANIFEST_NAME} not found in folder`,
          folderId: MANIFEST_FOLDER_ID,
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const manifestText = await restletGetLines(token, manifestId, 1000);
    const manifest = JSON.parse(stripBom(manifestText)) as ManifestShape;

    const fulfillParts = getManifestParts(
      (manifest as any)?.files?.fulfillments
    );
    const lineParts = getManifestParts(
      (manifest as any)?.files?.fulfillment_lines
    );

    if (!fulfillParts.length || !lineParts.length) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "InvalidManifest",
          details:
            "Manifest missing fulfillments parts and/or fulfillment_lines parts",
        }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      );
    }

    // Read all parts via Restlet (keeps your existing “files -> text -> parseJsonl” flow)
    const [fulfillText, linesText] = await Promise.all([
      restletGetLinesForParts(token, fulfillParts, 1000),
      restletGetLinesForParts(token, lineParts, 1000),
    ]);

    // optional disk dump (mirrors your invoice route)
    const outDir = path.resolve(process.cwd(), "exports");
    await fs.mkdir(outDir, { recursive: true });
    const fulfillPath = path.join(outDir, `fulfillments.jsonl`);
    const linesPath = path.join(outDir, `fulfillment_lines.jsonl`);
    await Promise.all([
      fs.writeFile(fulfillPath, stripBom(fulfillText), { encoding: "utf8" }),
      fs.writeFile(linesPath, stripBom(linesText), { encoding: "utf8" }),
    ]);

    const fileFulfillments = parseJsonl(fulfillText);
    const fileLines = parseJsonl(linesText);

    // Only fulfillments file is authoritative for what “exists”
    const fileIdsFromFulfillments = Array.from(
      new Set<number>(
        fileFulfillments
          .map((r: any) => Number(r.fulfillment_id))
          .filter((n: number) => Number.isFinite(n) && n > 0)
      )
    ).sort((a, b) => a - b);

    // Union used for “replace lines” (safe, but we filter to valid upserts later)
    const fileIdsFromLines = Array.from(
      new Set<number>(
        fileLines
          .map((r: any) => Number(r.fulfillment_id))
          .filter((n: number) => Number.isFinite(n) && n > 0)
      )
    );

    const fileFulfillmentIdsUnion = Array.from(
      new Set<number>([...fileIdsFromFulfillments, ...fileIdsFromLines])
    ).sort((a, b) => a - b);

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const dbActiveIds = await fetchActiveFulfillmentIds(supabase);
    const fileOnlySet = new Set<number>(fileIdsFromFulfillments);
    const missingInFiles = dbActiveIds.filter((id) => !fileOnlySet.has(id));

    const existing = await fetchExistingFulfillmentsInBatches(
      supabase,
      fileIdsFromFulfillments
    );
    const dbMap = new Map<
      number,
      Database["public"]["Tables"]["fulfillments"]["Row"]
    >();
    for (const r of existing) dbMap.set(Number(r.fulfillment_id), r);

    const supaResult = await upsertFulfillmentSnapshotToSupabase(
      supabase,
      fileFulfillments,
      fileLines,
      dbMap,
      fileFulfillmentIdsUnion,
      missingInFiles
    );

    return new Response(
      JSON.stringify({
        ok: true,
        manifest_generated_at: manifest.generated_at,
        manifest_parts: {
          fulfillments: fulfillParts.map((p) => ({
            id: p.id,
            name: p.name,
            rows: p.rows,
          })),
          fulfillment_lines: lineParts.map((p) => ({
            id: p.id,
            name: p.name,
            rows: p.rows,
          })),
        },
        saved_files: {
          fulfillments: { path: fulfillPath, rows: fileFulfillments.length },
          fulfillment_lines: { path: linesPath, rows: fileLines.length },
        },
        counts: {
          fulfillments_in_file: fileFulfillments.length,
          fulfillment_lines_in_file: fileLines.length,
          active_fulfillments_in_db: dbActiveIds.length,
          missing_in_files: missingInFiles.length,
        },
        upsert: supaResult,
        debug: {
          missing_in_files_sample: missingInFiles.slice(0, 10),
        },
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
      { status, headers: { "Content-Type": "application/json" } }
    );
  }
}
