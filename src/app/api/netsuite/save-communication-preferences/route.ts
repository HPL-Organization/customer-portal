// app/api/netsuite/save-communication-preferences/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getValidToken } from "@/lib/netsuite/token";

export const dynamic = "force-dynamic";

function recordsBase(): string {
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
  return `https://${accountId}.suitetalk.api.netsuite.com/services/rest/record/v1`;
}

const CHILD_RECORD_TYPE = "customrecord_hpl_communicationpreference";
const FIELD_CUSTOMER = "custrecord_hpl_cust_compref";
const FIELD_CATEGORY = "custrecord_hpl_cust_comcategory";
const FIELD_FREQUENCY = "custrecord_hpl_compref_frequency";
const FIELD_OPTIN = "custrecord_hpl_compref_optin";
const FIELD_CONSENT = "custrecord_hpl_compref_consent";
const FIELD_EMAIL = "custrecord_hpl_preference_email";
const FIELD_SMS = "custrecord_hpl_preference_sms";
const FIELD_PHONE = "custrecord_hpl_preference_phone";

type InPref = {
  recordId?: number | string | null;
  categoryId?: number | string | null;
  frequencyId?: number | string | null;
  optIn?: boolean | null;
  email?: boolean | null;
  sms?: boolean | null;
  phone?: boolean | null;
};

type BodyIn = {
  customerId: number | string;
  preferences: InPref[];
};

function safeParse(text: string | null | undefined) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function idFromLocation(h: Headers) {
  const loc = h.get("Location") || h.get("location") || "";
  const m = loc.match(/\/([0-9]+)(\?|$)/);
  return m ? Number(m[1]) : undefined;
}

const asRef = (id: any) =>
  id == null || id === "" ? undefined : { id: String(id) };

function buildPayload(p: InPref, nsCustomerId?: number) {
  const payload: any = {};
  if (nsCustomerId != null) payload[FIELD_CUSTOMER] = asRef(nsCustomerId);
  if (p.categoryId != null) payload[FIELD_CATEGORY] = asRef(p.categoryId);
  if (p.frequencyId != null) payload[FIELD_FREQUENCY] = asRef(p.frequencyId);
  if (p.optIn != null) payload[FIELD_OPTIN] = !!p.optIn;

  payload[FIELD_CONSENT] = asRef(1);

  if (p.email != null) payload[FIELD_EMAIL] = !!p.email;
  if (p.sms != null) payload[FIELD_SMS] = !!p.sms;
  if (p.phone != null) payload[FIELD_PHONE] = !!p.phone;

  return payload;
}

async function listExistingForCustomer(
  base: string,
  token: string,
  customerId: number
) {
  const TYPE = encodeURIComponent(CHILD_RECORD_TYPE);
  const attempts = [
    `${base}/${TYPE}?q=${encodeURIComponent(
      `${FIELD_CUSTOMER}.id==${customerId}`
    )}&limit=1000`,
    `${base}/${TYPE}?q=${encodeURIComponent(
      `${FIELD_CUSTOMER}==${customerId}`
    )}&limit=1000`,
    `${base}/${TYPE}?limit=1000`,
  ];
  for (let i = 0; i < attempts.length; i++) {
    const r = await fetch(attempts[i], {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        Prefer: "transient",
      },
    });
    const text = await r.text();
    if (!r.ok) {
      if (i < attempts.length - 1) continue;
      throw new Error(`List failed ${r.status}: ${text}`);
    }
    let items: any[] = safeParse(text)?.items ?? [];
    if (i === attempts.length - 1) {
      items = items.filter((it) => {
        const v = it[FIELD_CUSTOMER] ?? it?.values?.[FIELD_CUSTOMER];
        const id =
          v && typeof v === "object" && v.id != null ? Number(v.id) : Number(v);
        return id === customerId;
      });
    }
    return items;
  }
  return [];
}

export async function POST(req: NextRequest) {
  let body: BodyIn;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const nsCustomerId = Number(body?.customerId);
  if (!Number.isFinite(nsCustomerId) || nsCustomerId <= 0)
    return NextResponse.json(
      { error: "customerId must be a positive number" },
      { status: 400 }
    );
  if (!Array.isArray(body?.preferences))
    return NextResponse.json(
      { error: "preferences must be an array" },
      { status: 400 }
    );

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

  const base = recordsBase();

  let existing: any[];
  try {
    existing = await listExistingForCustomer(base, token, nsCustomerId);
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message ?? e) },
      { status: 502 }
    );
  }

  const byCategory = new Map<string, number>();
  for (const row of existing) {
    const rid = Number(row.id);
    const cat = row[FIELD_CATEGORY] ?? row?.values?.[FIELD_CATEGORY];
    const catId =
      cat && typeof cat === "object" && cat.id != null
        ? String(cat.id)
        : String(cat);
    if (Number.isFinite(rid) && catId) byCategory.set(catId, rid);
  }

  const results: { created: any[]; updated: any[]; errors: any[] } = {
    created: [],
    updated: [],
    errors: [],
  };

  for (const p of body.preferences) {
    const categoryKey = p.categoryId != null ? String(p.categoryId) : undefined;
    const explicitId =
      p.recordId != null && Number.isFinite(Number(p.recordId))
        ? Number(p.recordId)
        : undefined;
    const targetId =
      explicitId ??
      (categoryKey ? byCategory.get(categoryKey) : undefined) ??
      undefined;

    try {
      if (targetId) {
        const payload = buildPayload(p);
        const r = await fetch(
          `${base}/${encodeURIComponent(CHILD_RECORD_TYPE)}/${targetId}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              Accept: "application/json",
              Prefer: "return=representation,transient",
            },
            body: JSON.stringify(payload),
          }
        );
        const text = await r.text();
        if (!r.ok) throw new Error(text || `PATCH ${r.status}`);
        const parsed = safeParse(text);
        results.updated.push(parsed ?? { id: targetId, raw: text || null });
      } else {
        const payload = buildPayload(p, nsCustomerId);
        const r = await fetch(
          `${base}/${encodeURIComponent(CHILD_RECORD_TYPE)}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              Accept: "application/json",
              Prefer: "return=representation,transient",
            },
            body: JSON.stringify(payload),
          }
        );
        const text = await r.text();
        if (!r.ok) throw new Error(text || `POST ${r.status}`);
        const parsed = safeParse(text);
        results.created.push(
          parsed ?? { id: idFromLocation(r.headers), raw: text || null }
        );
      }
    } catch (e: any) {
      results.errors.push({ pref: p, error: String(e?.message ?? e) });
    }
  }

  return NextResponse.json(results, { status: 200 });
}
