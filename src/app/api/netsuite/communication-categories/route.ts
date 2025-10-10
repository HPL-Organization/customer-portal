import { NextRequest, NextResponse } from "next/server";
import { getValidToken } from "@/lib/netsuite/token";

export const dynamic = "force-dynamic";

function getSuiteQLUrl(): string {
  const env = (process.env.NETSUITE_ENV || "prod").toLowerCase();
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
  // allow override via ?rt= for debug, default to the Email Category list
  const recordType =
    req.nextUrl.searchParams.get("rt") || "customlist_hpl_emailcategory";

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

  const sql = `SELECT id, name FROM ${recordType} ORDER BY name`;

  const r = await fetch(getSuiteQLUrl(), {
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
      {
        error: "Failed to list communication categories",
        status: r.status,
        details: text,
      },
      { status: r.status === 200 ? 502 : r.status }
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

  const items = (data?.items ?? [])
    .map((row: any) => ({
      id: Number(row.id),
      name: String(row.name),
    }))
    .filter((x: any) => Number.isFinite(x.id) && x.name);

  return NextResponse.json({ recordType, items });
}
