import { NextRequest, NextResponse } from "next/server";
import { getValidToken } from "@/lib/netsuite/token";

export const dynamic = "force-dynamic";

function suiteqlUrl(): string {
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

function asBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return s === "t" || s === "true" || s === "y" || s === "yes" || s === "1";
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
  if (!Number.isFinite(customerId) || customerId <= 0)
    return NextResponse.json({ error: "Invalid customerId" }, { status: 400 });

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

  const sql = `
    SELECT
      r.id AS record_id,
      r.custrecord_hpl_customer_event_subscripti AS customer_id,
      r.custrecord_hpl_event_subscription_type AS event_type_id,
      r.custrecord_hpl_recieve_email AS email,
      r.custrecord_hpl_recieve_sms AS sms,
      r.custrecord_hpl_active_event AS active,
      r.custrecord_hpl_leavedate AS leave_date
    FROM customrecord_hpl_eventsubscription r
    WHERE r.custrecord_hpl_customer_event_subscripti = ${customerId}
  `;

  const r = await fetch(suiteqlUrl(), {
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
      { error: "SuiteQL query failed", status: r.status, details: text },
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

  const items = (data?.items ?? []).map((row: any) => ({
    recordId: Number(row.record_id),
    customerId: Number(row.customer_id),
    eventTypeId: Number(row.event_type_id),
    email: asBool(row.email),
    sms: asBool(row.sms),
    active: asBool(row.active),
    leaveDate: row.leave_date || null,
  }));

  return NextResponse.json({ customerId, subscriptions: items });
}
