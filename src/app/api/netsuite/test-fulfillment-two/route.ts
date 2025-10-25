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
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_SYNC_SECRET = process.env.ADMIN_SYNC_SECRET!;
const ADMIN_SECRET_HEADER = "x-admin-secret";

const http = axios.create({ timeout: 60000 });

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function netsuiteQuery(
  q: string,
  headers: Record<string, string>,
  tag?: string
) {
  let attempt = 0;
  const delays = [500, 1000, 2000, 4000, 8000];
  for (;;) {
    try {
      return await http.post(
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
        await new Promise((r) => setTimeout(r, d));
        attempt++;
        continue;
      }
      const e = new Error("SuiteQL " + (tag || "") + " failed");
      (e as any).details = {
        tag,
        status: err?.response?.status,
        code,
        details:
          err?.response?.data?.["o:errorDetails"]?.[0]?.detail ||
          err?.response?.data,
        q,
      };
      throw e;
    }
  }
}

async function resolveCustomerInternalIds(
  headers: Record<string, string>,
  inputIds: number[]
) {
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
    await new Promise((res) => setTimeout(res, 60));
  }
  return Array.from(out);
}

function setOf<T>(arr: T[]) {
  return new Set(arr);
}

function isoDateOnly(s: string | null | undefined) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
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

  const url = new URL(req.url);
  const customerIdParam = url.searchParams.get("customerId");
  const onlyCustomerId = customerIdParam
    ? Number(customerIdParam)
    : Number(url.searchParams.get("onlyCustomerId") || "");
  const since =
    url.searchParams.get("since") || url.searchParams.get("forceSince") || "";
  const forceAll =
    url.searchParams.get("forceAll") === "1" ||
    url.searchParams.get("forceAll") === "true";
  const scope = url.searchParams.get("scope") || "";
  const resolveIdsFlag =
    url.searchParams.get("resolveIds") === "1" ||
    url.searchParams.get("resolveIds") === "true";
  const lookbackDays = Number(url.searchParams.get("lookbackDays") ?? 90);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: profileRows } = await supabase
    .from("profiles")
    .select("netsuite_customer_id");
  const baseCustomerIds = Array.from(
    new Set(
      (profileRows || [])
        .map((r: any) => Number(r.netsuite_customer_id))
        .filter(Number.isFinite)
    )
  );
  const token = await getValidToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    Prefer: "transient, maxpagesize=1000",
  } as Record<string, string>;

  let effectiveCustomerIds = baseCustomerIds;
  if (Number.isFinite(onlyCustomerId)) effectiveCustomerIds = [onlyCustomerId];
  else if (resolveIdsFlag && baseCustomerIds.length)
    effectiveCustomerIds = await resolveCustomerInternalIds(
      headers,
      baseCustomerIds
    );

  const effectiveSet = setOf(effectiveCustomerIds);
  const sinceClause = since
    ? `AND T.trandate >= TO_DATE('${since}','YYYY-MM-DD')`
    : `AND T.trandate >= TO_DATE('${new Date(
        Date.now() - lookbackDays * 86400000
      )
        .toISOString()
        .slice(0, 10)}','YYYY-MM-DD')`;

  const idsByEntity: number[] = [];
  const idsViaSO: number[] = [];
  const idsViaInv: number[] = [];

  try {
    if (Number.isFinite(onlyCustomerId)) {
      const q1 = `
        SELECT T.id AS id
        FROM transaction T
        WHERE T.type='ItemShip' AND T.entity=${onlyCustomerId}
        ${sinceClause}
      `;
      const r1 = await netsuiteQuery(q1, headers, "byEntity");
      for (const row of r1?.data?.items || []) {
        const id = Number(row.id);
        if (Number.isFinite(id)) idsByEntity.push(id);
      }

      const q2 = `
        SELECT T2.id AS id
        FROM PreviousTransactionLink PTL
        JOIN transaction S ON S.id = PTL.PreviousDoc AND S.type='SalesOrd' AND S.entity=${onlyCustomerId}
        JOIN transaction T2 ON T2.id = PTL.NextDoc AND T2.type='ItemShip'
        ${since ? `WHERE T2.trandate >= TO_DATE('${since}','YYYY-MM-DD')` : ""}
      `;
      const r2 = await netsuiteQuery(q2, headers, "viaSO");
      for (const row of r2?.data?.items || []) {
        const id = Number(row.id);
        if (Number.isFinite(id)) idsViaSO.push(id);
      }

      const q3 = `
        SELECT T2.id AS id
        FROM transaction I
        JOIN PreviousTransactionLink PTL1 ON PTL1.NextDoc = I.id
        JOIN PreviousTransactionLink PTL2 ON PTL2.PreviousDoc = PTL1.PreviousDoc
        JOIN transaction T2 ON T2.id = PTL2.NextDoc AND T2.type='ItemShip'
        WHERE I.type='CustInvc' AND I.entity=${onlyCustomerId}
        ${since ? `AND T2.trandate >= TO_DATE('${since}','YYYY-MM-DD')` : ""}
      `;
      const r3 = await netsuiteQuery(q3, headers, "viaInvoiceLink");
      for (const row of r3?.data?.items || []) {
        const id = Number(row.id);
        if (Number.isFinite(id)) idsViaInv.push(id);
      }
    } else {
      const entCsv = effectiveCustomerIds.slice(0, 900).join(",");
      if (entCsv) {
        const q1 = `
          SELECT T.id AS id
          FROM transaction T
          WHERE T.type='ItemShip' AND T.entity IN (${entCsv})
          ${sinceClause}
        `;
        const r1 = await netsuiteQuery(q1, headers, "byEntity");
        for (const row of r1?.data?.items || []) {
          const id = Number(row.id);
          if (Number.isFinite(id)) idsByEntity.push(id);
        }

        const q2 = `
          SELECT T2.id AS id
          FROM PreviousTransactionLink PTL
          JOIN transaction S ON S.id = PTL.PreviousDoc AND S.type='SalesOrd' AND S.entity IN (${entCsv})
          JOIN transaction T2 ON T2.id = PTL.NextDoc AND T2.type='ItemShip'
          ${
            since ? `WHERE T2.trandate >= TO_DATE('${since}','YYYY-MM-DD')` : ""
          }
        `;
        const r2 = await netsuiteQuery(q2, headers, "viaSO");
        for (const row of r2?.data?.items || []) {
          const id = Number(row.id);
          if (Number.isFinite(id)) idsViaSO.push(id);
        }

        const q3 = `
          SELECT T2.id AS id
          FROM transaction I
          JOIN PreviousTransactionLink PTL1 ON PTL1.NextDoc = I.id
          JOIN PreviousTransactionLink PTL2 ON PTL2.PreviousDoc = PTL1.PreviousDoc
          JOIN transaction T2 ON T2.id = PTL2.NextDoc AND T2.type='ItemShip'
          WHERE I.type='CustInvc' AND I.entity IN (${entCsv})
          ${since ? `AND T2.trandate >= TO_DATE('${since}','YYYY-MM-DD')` : ""}
        `;
        const r3 = await netsuiteQuery(q3, headers, "viaInvoiceLink");
        for (const row of r3?.data?.items || []) {
          const id = Number(row.id);
          if (Number.isFinite(id)) idsViaInv.push(id);
        }
      }
    }
  } catch (e: any) {
    return new Response(
      JSON.stringify(
        {
          error: "discovery_failed",
          details: e?.details || String(e),
        },
        null,
        2
      ),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const unionIds = Array.from(
    new Set([...idsByEntity, ...idsViaSO, ...idsViaInv])
  );
  unionIds.sort((a, b) => a - b);

  const headersQ = `
    SELECT
      T.id AS fulfillmentId,
      T.tranid AS tranId,
      T.trandate AS trandate,
      T.entity AS customerId,
      TRIM(BUILTIN.DF(T.entity)) AS customerText,
      BUILTIN.DF(T.status) AS status
    FROM transaction T
    WHERE T.type='ItemShip' AND T.id IN (${
      unionIds.length ? unionIds.join(",") : "0"
    })
  `;
  const h = unionIds.length
    ? await netsuiteQuery(headersQ, headers, "headers")
    : { data: { items: [] } };
  const headById = new Map<number, any>();
  for (const row of (h as any)?.data?.items || []) {
    const id = Number(row.fulfillmentid);
    headById.set(id, {
      id,
      tran_id: row.tranid ?? null,
      trandate: row.trandate ?? null,
      customer_id: row.customerid != null ? Number(row.customerid) : null,
      customer_text: row.customertext ?? null,
      status: row.status ?? null,
    });
  }

  const detailHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    Prefer: "transient",
  } as const;

  const detailProbes: Array<{
    id: number;
    ok: boolean;
    httpStatus: number | null;
    code?: string;
  }> = [];
  for (const batch of chunk(unionIds, 20)) {
    const results = await Promise.all(
      batch.map(async (id) => {
        try {
          const r = await http.get(
            `${BASE_URL}/record/v1/itemFulfillment/${id}?expandSubResources=false`,
            { headers: detailHeaders }
          );
          return { id, ok: true, httpStatus: r.status };
        } catch (e: any) {
          const status = e?.response?.status ?? null;
          const code =
            e?.response?.data?.["o:errorDetails"]?.[0]?.["o:errorCode"];
          return { id, ok: false, httpStatus: status, code };
        }
      })
    );
    detailProbes.push(...results);
    await new Promise((r) => setTimeout(r, 50));
  }

  const { data: state } = await supabase
    .from("sync_state")
    .select("*")
    .eq("key", "fulfillments")
    .maybeSingle();
  const overlapMs = 10 * 60 * 1000;
  const baseSince =
    (state?.last_cursor as string | undefined) ??
    new Date(Date.now() - lookbackDays * 86400000).toISOString();
  const sinceIso = new Date(
    new Date(baseSince).getTime() - overlapMs
  ).toISOString();
  const sinceDate = sinceIso.slice(0, 10);

  function wouldMainInclude(id: number) {
    const head = headById.get(id);
    const reasons: string[] = [];
    if (!head) {
      reasons.push("no_header");
      return { include: false, reasons };
    }
    const cid = head.customer_id as number | null;
    if (cid == null) reasons.push("no_customer_id_on_header");
    const inProfiles = cid != null && effectiveSet.has(cid);
    if (!inProfiles) reasons.push("customer_not_in_profiles");
    if (forceAll) {
      if (scope !== "all" && (!cid || !effectiveSet.has(cid)))
        reasons.push("forceAll_scope_not_all_and_customer_not_in_batch");
      if (since) {
        const d = isoDateOnly(head.trandate);
        if (!d || d < since) reasons.push("trandate_before_forceSince");
      } else {
        const d = isoDateOnly(head.trandate);
        if (!d || d < sinceDate) reasons.push("trandate_before_cursor");
      }
    }
    const include = reasons.length === 0;
    return { include, reasons };
  }

  const diagnostics = unionIds.map((id) => {
    const head = headById.get(id) || {};
    const verdict = wouldMainInclude(id);
    const srcs: string[] = [];
    if (idsByEntity.includes(id)) srcs.push("entity");
    if (idsViaSO.includes(id)) srcs.push("salesorder_link");
    if (idsViaInv.includes(id)) srcs.push("invoice_link");
    return {
      id,
      customer_id: head.customer_id ?? null,
      customer_text: head.customer_text ?? null,
      status: head.status ?? null,
      trandate: head.trandate ?? null,
      sources: srcs,
      wouldMainInclude: verdict.include,
      reasonsIfExcluded: verdict.include ? [] : verdict.reasons,
    };
  });

  const counts = {
    byEntity: idsByEntity.length,
    viaSO: idsViaSO.length,
    viaInvoice: idsViaInv.length,
    union: unionIds.length,
  };

  return new Response(
    JSON.stringify(
      {
        input: {
          customerId: Number.isFinite(onlyCustomerId) ? onlyCustomerId : null,
          since: since || null,
          effectiveIds: effectiveCustomerIds,
          flags: { forceAll, scope, resolveIds: resolveIdsFlag },
        },
        counts,
        ids: {
          byEntity: idsByEntity,
          viaSO: idsViaSO,
          viaInvoice: idsViaInv,
          union: unionIds,
        },
        diagnostics,
        detailProbes,
        mainCursorContext: {
          lastCursor: state?.last_cursor || null,
          overlapAppliedMs: overlapMs,
          effectiveSinceIso: sinceIso,
          effectiveSinceDate: sinceDate,
        },
      },
      null,
      2
    ),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
