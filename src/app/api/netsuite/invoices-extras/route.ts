import { NextRequest } from "next/server";
import { getValidToken } from "@/lib/netsuite/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const REST_BASE = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postSuiteQL(
  q: string,
  headers: Record<string, string>,
  tag: string
) {
  let attempt = 0;
  const delays = [500, 1000, 2000, 4000, 8000];
  for (;;) {
    console.log(
      `[inv-extras:${tag}] POST /query/v1/suiteql attempt=${attempt + 1}`
    );
    const res = await fetch(`${REST_BASE}/query/v1/suiteql`, {
      method: "POST",
      headers,
      body: JSON.stringify({ q }),
    });
    const ctype = res.headers.get("content-type") || "";
    console.log(`[inv-extras:${tag}] status=${res.status} ctype=${ctype}`);
    if (res.ok) return await res.json();

    const isJson = ctype.includes("application/json");
    const body = isJson ? await res.json().catch(() => ({})) : await res.text();
    const code = isJson
      ? body?.["o:errorDetails"]?.[0]?.["o:errorCode"]
      : undefined;
    if (res.status === 429 || code === "CONCURRENCY_LIMIT_EXCEEDED") {
      const d = delays[Math.min(attempt, delays.length - 1)];
      console.warn(`[inv-extras:${tag}] 429; backoff ${d}ms`);
      await sleep(d);
      attempt++;
      continue;
    }
    console.error(`[inv-extras:${tag}] error`, {
      status: res.status,
      preview: isJson ? body : String(body).slice(0, 400),
    });
    throw { status: res.status, body };
  }
}

export async function GET(req: NextRequest) {
  const rid = Math.random().toString(36).slice(2, 8);
  try {
    const idStr =
      req.nextUrl.searchParams.get("id") ||
      req.nextUrl.searchParams.get("invoiceId");
    const invoiceId = Number(idStr);
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
      return new Response(
        JSON.stringify({ error: "Provide ?id=<invoiceId>" }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        }
      );
    }
    console.log(`[inv-extras:${rid}] start invoiceId=${invoiceId}`);

    const token = await getValidToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "transient",
    } as Record<string, string>;

    const qBase = `
      SELECT
        T.id                        AS invoiceId,
        T.tranid                    AS tranId,
        T.custbody_hpl_so_reference AS soReference
      FROM transaction T
      WHERE T.type = 'CustInvc' AND T.id = ${invoiceId}
    `;
    const base = await postSuiteQL(qBase, headers, `${rid}:base`);
    const b = base?.items?.[0];
    if (!b) {
      return new Response(JSON.stringify({ invoiceId, found: false }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    const qShip = `
      SELECT BUILTIN.DF(TS.DestinationAddress) AS shipToText
      FROM TransactionShipment TS
      WHERE TS.Doc = ${invoiceId}
      ORDER BY TS.id DESC
      FETCH NEXT 1 ROWS ONLY
    `;
    const ship = await postSuiteQL(qShip, headers, `${rid}:ship`);
    const shipFromSuiteQL: string | null = ship?.items?.[0]?.shiptotext ?? null;

    const qRep = `
      SELECT
        BUILTIN.DF(ST.employee) AS salesRepName,
        ST.isprimary            AS isPrimary,
        ST.contribution         AS contribution
      FROM TransactionSalesTeam ST
      WHERE ST.transaction = ${invoiceId}
      ORDER BY CASE WHEN ST.isprimary = 'T' THEN 0 ELSE 1 END,
               NVL(ST.contribution, 0) DESC
    `;
    const rep = await postSuiteQL(qRep, headers, `${rid}:rep`);
    const reps = Array.isArray(rep?.items) ? rep.items : [];
    const primary =
      reps.find((r: any) => String(r.isprimary || "").toUpperCase() === "T") ||
      reps[0] ||
      null;
    const salesRepName: string | null =
      (primary?.salesrepname as string | null) ?? null;

    const payload = {
      invoiceId: Number(b.invoiceid),
      tranId: b.tranid ?? null,
      tranId_source: "suiteql: transaction.tranid",

      soReference: b.soreference ?? null,
      soReference_source: "suiteql: transaction.custbody_hpl_so_reference",

      salesRep: salesRepName,
      salesRep_source: salesRepName
        ? "suiteql: TransactionSalesTeam (primary row, BUILTIN.DF(employee))"
        : null,

      shipAddress: shipFromSuiteQL,
      shipAddress_source: shipFromSuiteQL
        ? "suiteql: TransactionShipment.DestinationAddress via BUILTIN.DF(...)"
        : null,

      billAddress: null,
      billAddress_source: null,

      debug: {
        repsCount: reps?.length ?? 0,
        shipFromSuiteQLPreview: shipFromSuiteQL?.slice(0, 80) ?? null,
      },
      source: "suiteql",
    };

    console.log(`[inv-extras:${rid}] success`);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err: any) {
    console.error(`[inv-extras:${rid}] catch`, err);
    return new Response(
      JSON.stringify({
        error: "Query failed",
        status: err?.status || 500,
        details:
          typeof err?.body === "string"
            ? err.body.slice(0, 600)
            : err?.body ?? String(err),
        rid,
      }),
      {
        status: err?.status || 500,
        headers: { "content-type": "application/json" },
      }
    );
  }
}
