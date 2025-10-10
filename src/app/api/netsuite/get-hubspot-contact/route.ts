import { NextRequest, NextResponse } from "next/server";
import { getValidToken } from "@/lib/netsuite/token";

export const dynamic = "force-dynamic"; // no caching

function getSuiteQLUrl(): string {
  const env = (process.env.NETSUITE_ENV || "prod").toLowerCase(); // "sb" or "prod"
  const accountId =
    env === "sb"
      ? process.env.NETSUITE_ACCOUNT_ID_SB
      : process.env.NETSUITE_ACCOUNT_ID;

  if (!accountId) {
    throw new Error(
      env === "sb"
        ? "NETSUITE_ACCOUNT_ID_SB is not set"
        : "NETSUITE_ACCOUNT_ID is not set"
    );
  }
  return `https://${accountId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
}

export async function GET(req: NextRequest) {
  const idParam =
    req.nextUrl.searchParams.get("customerId") ??
    req.nextUrl.searchParams.get("nsId");
  if (!idParam)
    return NextResponse.json(
      { error: "Missing customerId (or nsId)" },
      { status: 400 }
    );

  const customerId = Number(idParam);
  if (!Number.isFinite(customerId) || customerId <= 0) {
    return NextResponse.json({ error: "Invalid customerId" }, { status: 400 });
  }

  let token: string;
  try {
    token = await getValidToken();
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "Failed to acquire NetSuite token",
        details: String(e?.message ?? e),
      },
      { status: 500 }
    );
  }

  const suiteqlUrl = getSuiteQLUrl();

  const sql = `SELECT id AS customer_id, custentityhs_id AS hubspot_id FROM customer WHERE id = ${customerId}`;

  const r = await fetch(suiteqlUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "transient",
    },
    body: JSON.stringify({ q: sql }),
  });

  const text = await r.text();
  if (!r.ok) {
    return NextResponse.json(
      { error: "SuiteQL query failed", details: text },
      { status: r.status }
    );
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: "Unexpected SuiteQL response", raw: text },
      { status: 502 }
    );
  }

  const row = data?.items?.[0];
  if (!row)
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const hubspotId = row?.hubspot_id ?? null;
  if (!hubspotId)
    return NextResponse.json(
      { error: "custentityhs_id is empty on customer" },
      { status: 404 }
    );

  return NextResponse.json({ customerId: row.customer_id, hubspotId });
}
