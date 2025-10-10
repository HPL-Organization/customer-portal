import { NextRequest, NextResponse } from "next/server";
import { getValidToken } from "@/lib/netsuite/token";

export const dynamic = "force-dynamic";

function getSuiteQLUrl(): string {
  const env = (process.env.NETSUITE_ENV || "prod").toLowerCase();
  const accountId =
    env === "sb"
      ? process.env.NETSUITE_ACCOUNT_ID_SB
      : process.env.NETSUITE_ACCOUNT_ID;
  if (!accountId)
    throw new Error(
      env === "sb"
        ? "NETSUITE_ACCOUNT_ID_SB is not set"
        : "NETSUITE_ACCOUNT_ID is not set"
    );
  return `https://${accountId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
}

function sqlEscapeLiteral(s: string) {
  return s.replace(/'/g, "''");
}

export async function GET(req: NextRequest) {
  const emailRaw = req.nextUrl.searchParams.get("email");
  if (!emailRaw)
    return NextResponse.json({ error: "Missing ?email" }, { status: 400 });
  const email = emailRaw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
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

  const q = `
    select id
    from customer
    where lower(email) = '${sqlEscapeLiteral(email)}'
  `;

  const r = await fetch(getSuiteQLUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "transient",
    },
    body: JSON.stringify({ q }),
  });

  const text = await r.text();
  if (!r.ok) {
    return NextResponse.json(
      { error: "Lookup failed", status: r.status, details: text },
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

  const id = Number(data?.items?.[0]?.id ?? NaN);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ id: null }, { status: 404 });
  }

  return NextResponse.json({ id });
}
