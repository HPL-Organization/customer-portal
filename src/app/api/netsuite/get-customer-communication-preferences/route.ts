// app/api/netsuite/get-customer-communication-preferences/route.ts
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
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "t" || s === "true" || s === "y" || s === "yes" || s === "1";
}

function parseMulti(val: any): number[] {
  if (val == null) return [];
  if (Array.isArray(val)) return val.map(Number).filter(Number.isFinite);
  const s = String(val);
  const SEP = String.fromCharCode(5);
  return (s.includes(SEP) ? s.split(SEP) : s.split(","))
    .map((p) => Number(p.trim()))
    .filter(Number.isFinite);
}

export async function GET(req: NextRequest) {
  const idParam =
    req.nextUrl.searchParams.get("customerId") ??
    req.nextUrl.searchParams.get("nsId");
  if (!idParam) {
    return NextResponse.json(
      { error: "Missing customerId (or nsId)" },
      { status: 400 }
    );
  }

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

  const sql = `
    SELECT
      r.id                                        AS record_id,
      r.custrecord_hpl_cust_compref               AS customer_id,
      r.custrecord_hpl_cust_comcategory           AS category_id,
      r.custrecord_hpl_compref_frequency          AS frequency_id,
      r.custrecord_hpl_compref_optin              AS opt_in,
      r.custrecord_hpl_compref_consent            AS consent_method_id,
      r.custrecord_hpl_commethods                 AS methods_raw,
      r.custrecord_hpl_preference_email           AS email_chk,
      r.custrecord_hpl_preference_sms             AS sms_chk,
      r.custrecord_hpl_preference_phone           AS phone_chk,
      r.custrecord_hpl_compref_lastupdated        AS last_updated
    FROM customrecord_hpl_communicationpreference r
    WHERE r.custrecord_hpl_cust_compref = ${customerId}
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
    categoryId: Number(row.category_id),
    frequencyId: row.frequency_id == null ? null : Number(row.frequency_id),
    optIn: asBool(row.opt_in),
    consentMethodId:
      row.consent_method_id == null ? null : Number(row.consent_method_id),
    methods: parseMulti(row.methods_raw),
    email: asBool(row.email_chk),
    sms: asBool(row.sms_chk),
    phone: asBool(row.phone_chk),
    lastUpdated: row.last_updated || null,
  }));

  return NextResponse.json({
    customerId,
    recordType: "customrecord_hpl_communicationpreference",
    count: items.length,
    preferences: items,
  });
}
