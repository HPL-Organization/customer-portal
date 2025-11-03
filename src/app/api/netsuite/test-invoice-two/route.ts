// src/app/api/netsuite/test-invoice-two/route.ts
import { NextRequest } from "next/server";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { getValidToken } from "@/lib/netsuite/token";

type Database = {
  public: {
    Tables: {
      profiles: { Row: { netsuite_customer_id: number | null } };
    };
  };
};

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_SYNC_SECRET = process.env.ADMIN_SYNC_SECRET!;
const ADMIN_SECRET_HEADER = "x-admin-secret";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function netsuiteQuery(
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

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(req: NextRequest) {
  // simple auth like your other admin routes
  if (
    !ADMIN_SYNC_SECRET ||
    req.headers.get(ADMIN_SECRET_HEADER) !== ADMIN_SYNC_SECRET
  ) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  // Params:
  // - lookbackDays: default 1
  // - limit: default 100
  // - resolveIds=1 to resolve internal IDs (optional, same idea as main route)
  // - includeEntities: comma-separated customer internal IDs (optional; otherwise use profiles)
  const url = new URL(req.url);
  const lookbackDays = Number(url.searchParams.get("lookbackDays") ?? 1);
  const limit = Math.max(
    1,
    Math.min(500, Number(url.searchParams.get("limit") ?? 100))
  );
  const resolveIds = url.searchParams.get("resolveIds") === "1";
  const includeEntitiesParam = url.searchParams.get("includeEntities");

  // Build sinceIso with a small overlap
  const overlapMs = 10 * 60 * 1000;
  const sinceIso = new Date(Date.now() - lookbackDays * 86400000 - overlapMs)
    .toISOString()
    .replace("Z", "Z"); // keep Z

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  let effectiveCustomerIds: number[] = [];

  if (includeEntitiesParam) {
    effectiveCustomerIds = includeEntitiesParam
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  } else {
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("netsuite_customer_id");
    if (error) {
      return new Response(
        JSON.stringify({
          error: "Failed to load profiles",
          details: String(error?.message || error),
        }),
        { status: 500 }
      );
    }
    effectiveCustomerIds = Array.from(
      new Set(
        (profiles || [])
          .map((r) => Number(r.netsuite_customer_id))
          .filter(Number.isFinite)
      )
    );
  }

  if (!effectiveCustomerIds.length) {
    return new Response(
      JSON.stringify({
        ok: true,
        message: "No customer IDs to test against.",
        sinceIso,
      }),
      { status: 200 }
    );
  }

  const token = await getValidToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    Prefer: "transient, maxpagesize=1000",
  } as Record<string, string>;

  // We’ll run a single SuiteQL that:
  //  - pulls payments (CustPymt) modified since `sinceIso`
  //  - for our customer set
  //  - joins TL to get the linked invoice (createdfrom)
  //  - returns payment lastmodifieddate as ISO string
  //
  // Note: We page entities in chunks so the IN (...) isn’t too long.
  const rows: Array<{
    paymentId: number;
    tranId: string | null;
    pLmIso: string | null;
    customerId: number | null;
    invoiceId: number | null;
  }> = [];

  for (const batch of chunk(effectiveCustomerIds, 900)) {
    const entList = batch.join(",");
    const q = `
      SELECT DISTINCT
        P.id AS paymentId,
        P.tranid AS tranId,
        TO_CHAR(P.lastmodifieddate,'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS pLmIso,
        P.entity AS customerId,
        TL.createdfrom AS invoiceId
      FROM transaction P
      JOIN transactionline TL
        ON TL.transaction = P.id
      WHERE P.type = 'CustPymt'
        AND P.entity IN (${entList})
        AND P.lastmodifieddate >= TO_TIMESTAMP_TZ('${sinceIso}','YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"')
        AND TL.createdfrom IS NOT NULL
      ORDER BY P.lastmodifieddate DESC
      FETCH NEXT ${limit} ROWS ONLY
    `;

    try {
      const r = await netsuiteQuery(q, headers, "testPaidSince");
      for (const row of r?.data?.items || []) {
        rows.push({
          paymentId: Number(row.paymentid),
          tranId: row.tranid ?? null,
          pLmIso: row.plmiso ?? null,
          customerId: row.customerid != null ? Number(row.customerid) : null,
          invoiceId: row.invoiceid != null ? Number(row.invoiceid) : null,
        });
      }
    } catch (e: any) {
      return new Response(
        JSON.stringify({
          error: "SuiteQL failed",
          details: e?.details ?? String(e),
          sinceIso,
          entCount: effectiveCustomerIds.length,
          sampleEntities: effectiveCustomerIds.slice(0, 20),
        }),
        { status: 500 }
      );
    }
  }

  // Deduplicate by (paymentId, invoiceId) just in case multiple TL rows pop
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    const k = `${r.paymentId}:${r.invoiceId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return new Response(
    JSON.stringify({
      ok: true,
      sinceIso,
      entCount: effectiveCustomerIds.length,
      returned: deduped.length,
      sample: deduped.slice(0, 25), // small preview
      note: "This shows payments (CustPymt) modified since `sinceIso` and their linked invoices (TL.createdfrom). `pLmIso` is the payment lastmodifieddate.",
    }),
    { status: 200 }
  );
}
