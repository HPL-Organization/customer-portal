// app/api/sync-eta/route.ts
import { NextRequest } from "next/server";
import axios from "axios";
import { getValidToken } from "@/lib/netsuite/token";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;

const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

const ADMIN_SYNC_SECRET = process.env.ADMIN_SYNC_SECRET!;
const ADMIN_SECRET_HEADER = "x-admin-secret";

const MANIFEST_FOLDER_ID = Number(process.env.NS_EXPORT_FOLDER_ID || 2279);
const MANIFEST_NAME = "manifest_eta_all_lines_latest.json";

const RL_SCRIPT_ID = 2935;
const RL_DEPLOY_ID = "customdeploy1";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type ManifestShape = {
  generated_at?: string;
  tag?: string;
  folder_id?: number;
  location_id?: number;
  location_name?: string;
  counts?: any;
  notes?: any;
  files?: {
    eta_all_lines?: { id: string | number; name: string; rows: number };
  };
};

type Database = {
  public: {
    Tables: {
      eta_so_line_etas: {
        Row: {
          item_id: number;
          location_id: number;
          so_id: number;
          line_seq: number;

          location_name: string | null;
          starting_on_hand: number | null;

          so_tranid: string | null;
          customer: string | null;
          customer_id: number | null;
          ns_line_id: number | null;

          queue_date: string | null;
          tran_date: string | null;
          ship_date: string | null;

          qty_remaining: number | null;
          projected_after: number | null;
          deficit: number | null;

          eta_date: string | null;
          eta_source_type: string | null;
          eta_source_id: number | null;
          eta_source_tranid: string | null;
          eta_source_qty: number | null;

          manifest_generated_at: string | null;
          synced_at: string | null;
          ns_deleted_at: string | null;
        };
        Insert: Partial<
          Database["public"]["Tables"]["eta_so_line_etas"]["Row"]
        >;
        Update: Partial<
          Database["public"]["Tables"]["eta_so_line_etas"]["Row"]
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
  const r = await netsuiteQuery(q, headers, "findFileByName");
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
      // IMPORTANT: restlet chunks already contain newline at end sometimes,
      // we normalize by just concatenating as-is (no forced extra newline).
      out += text;
      if (!out.endsWith("\n")) out += "\n";
    }

    const returned = Number(body.linesReturned || 0);
    if (body.done || returned < pageLines) break;
    lineStart += returned;
  }

  return stripBom(out);
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
      // ignore bad lines
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

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function softDeleteSnapshotForLocations(
  supabase: SupabaseClient<Database>,
  locationIds: number[],
  nowIso: string
) {
  const uniq = Array.from(new Set(locationIds)).filter((x) => x > 0);
  for (const batch of chunk(uniq, 1000)) {
    const { error } = await supabase
      .from("eta_so_line_etas")
      .update({
        ns_deleted_at: nowIso,
        synced_at: nowIso,
      } as Database["public"]["Tables"]["eta_so_line_etas"]["Update"])
      .in("location_id", batch)
      .is("ns_deleted_at", null);

    if (error) throw error;
  }
}

export async function POST(req: NextRequest) {
  try {
    if (
      !ADMIN_SYNC_SECRET ||
      req.headers.get(ADMIN_SECRET_HEADER) !== ADMIN_SYNC_SECRET
    ) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({} as any));
    const manifestNameOverride = coerceNull(body?.manifestName);
    const manifestName = manifestNameOverride || MANIFEST_NAME;

    const token = await getValidToken();
    const headers = authHeaders(token);

    const manifestId = await getFileIdByNameInFolder(
      headers,
      manifestName,
      MANIFEST_FOLDER_ID
    );

    if (!manifestId) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "NotFound",
          details: `${manifestName} not found in folder`,
          folderId: MANIFEST_FOLDER_ID,
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const manifestText = await restletGetLines(token, manifestId, 1000);

    let manifest: ManifestShape | null = null;
    try {
      manifest = JSON.parse(stripBom(manifestText)) as ManifestShape;
    } catch (e: any) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "InvalidManifestJson",
          details: String(e?.message || e),
        }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      );
    }

    const etaFileId = manifest?.files?.eta_all_lines?.id;
    const etaFileName =
      manifest?.files?.eta_all_lines?.name || "eta_all_lines.jsonl";

    if (!etaFileId) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "InvalidManifest",
          details: {
            expected: "manifest.files.eta_all_lines.id",
            got_files_keys: manifest?.files
              ? Object.keys(manifest.files)
              : null,
          },
        }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      );
    }

    const etaText = await restletGetLines(token, etaFileId, 1000);
    const fileRows = parseJsonl(etaText);

    if (!fileRows.length) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "EmptyEtaFile",
          details: { eta_file_id: etaFileId, eta_file_name: etaFileName },
        }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      );
    }

    // Optional disk dump for debugging
    const outDir = path.resolve(process.cwd(), "exports");
    await fs.mkdir(outDir, { recursive: true });
    const etaPath = path.join(outDir, etaFileName);
    await fs.writeFile(etaPath, etaText, { encoding: "utf8" });

    const nowIso = new Date().toISOString();

    // locations present in this snapshot
    const locationIdsInFile = Array.from(
      new Set(
        fileRows
          .map((r: any) => Number(r.location_id))
          .filter((n: number) => Number.isFinite(n) && n > 0)
      )
    );

    if (!locationIdsInFile.length) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "MissingLocationIds",
          details:
            "No valid location_id found in file rows. Ensure your JSONL includes location_id.",
        }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Replace-snapshot semantics for the location(s) included in this file
    await softDeleteSnapshotForLocations(supabase, locationIdsInFile, nowIso);

    const rowsToUpsert: Database["public"]["Tables"]["eta_so_line_etas"]["Insert"][] =
      [];

    for (const r of fileRows) {
      const itemId = Number(r.item_id);
      const locationId = Number(r.location_id);
      const soId = Number(r.so_id);
      const lineSeq = Number(r.line_seq);

      if (!Number.isFinite(itemId) || itemId <= 0) continue;
      if (!Number.isFinite(locationId) || locationId <= 0) continue;
      if (!Number.isFinite(soId) || soId <= 0) continue;
      if (!Number.isFinite(lineSeq)) continue;

      rowsToUpsert.push({
        item_id: itemId,
        location_id: locationId,
        so_id: soId,
        line_seq: lineSeq,

        location_name: coerceNull(r.location_name ?? manifest?.location_name),
        starting_on_hand: toNumOrNull(r.starting_on_hand),

        so_tranid: coerceNull(r.so_tranid),

        customer_id: toNumOrNull(r.customer_id),
        ns_line_id: toNumOrNull(r.ns_line_id),

        customer: coerceNull(r.customer),

        queue_date: normalizeDateToIso(coerceNull(r.queue_date)),
        tran_date: normalizeDateToIso(coerceNull(r.tran_date)),
        ship_date: normalizeDateToIso(coerceNull(r.ship_date)),

        qty_remaining: toNumOrNull(r.qty_remaining),
        projected_after: toNumOrNull(r.projected_after),
        deficit: toNumOrNull(r.deficit),

        eta_date: normalizeDateToIso(coerceNull(r.eta_date)),
        eta_source_type: coerceNull(r.eta_source_type),
        eta_source_id: toNumOrNull(r.eta_source_id),
        eta_source_tranid: coerceNull(r.eta_source_tranid),
        eta_source_qty: toNumOrNull(r.eta_source_qty),

        manifest_generated_at: coerceNull(manifest?.generated_at) ?? null,
        synced_at: nowIso,
        ns_deleted_at: null,
      });
    }

    let upserted = 0;
    for (const batch of chunk(rowsToUpsert, 1000)) {
      const { error } = await supabase
        .from("eta_so_line_etas")
        .upsert(batch, { onConflict: "item_id,location_id,so_id,line_seq" });

      if (error) throw error;
      upserted += batch.length;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        manifest_name: manifestName,
        manifest_id: manifestId,
        manifest_generated_at: manifest?.generated_at ?? null,
        eta_file: { id: etaFileId, name: etaFileName },
        locations_in_file: locationIdsInFile,
        saved_files: { eta: { path: etaPath, rows: fileRows.length } },
        counts: { rows_in_file: fileRows.length, rows_upserted: upserted },
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
