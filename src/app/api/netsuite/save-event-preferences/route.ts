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

type PrefIn = {
  id: string | number;
  recordId?: string | number | null;
  subscribed: boolean;
  email: boolean;
  sms: boolean;
};
type BodyIn = {
  customerId: number | string;
  preferences: PrefIn[];
  dryRun?: boolean;
};

const CHILD_RECORD_TYPE = "customrecord_hpl_eventsubscription";
const FIELD_PARENT_CUSTOMER = "custrecord_hpl_customer_event_subscripti";
const FIELD_EVENT_TYPE = "custrecord_hpl_event_subscription_type";
const FIELD_ACTIVE = "custrecord_hpl_active_event";
const FIELD_EMAIL = "custrecord_hpl_recieve_email";
const FIELD_SMS = "custrecord_hpl_recieve_sms";
const FIELD_LEAVE_DATE = "custrecord_hpl_leavedate";

type ListItem = { id?: string | number; values?: Record<string, any> } & Record<
  string,
  any
>;
const pick = (obj: any, key: string) =>
  obj?.[key] ?? (obj?.values ? obj.values[key] : undefined);

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

async function fetchChildList(
  base: string,
  token: string,
  nsId: number
): Promise<ListItem[]> {
  const attempts = [
    `${base}/${encodeURIComponent(CHILD_RECORD_TYPE)}?q=${encodeURIComponent(
      `${FIELD_PARENT_CUSTOMER}.id==${nsId}`
    )}&limit=1000`,
    `${base}/${encodeURIComponent(CHILD_RECORD_TYPE)}?q=${encodeURIComponent(
      `${FIELD_PARENT_CUSTOMER}==${nsId}`
    )}&limit=1000`,
    `${base}/${encodeURIComponent(CHILD_RECORD_TYPE)}?limit=1000`,
  ];
  for (let i = 0; i < attempts.length; i++) {
    const res = await fetch(attempts[i], {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        Prefer: "transient",
      },
    });
    const text = await res.text();
    if (!res.ok) {
      if (i < attempts.length - 1) continue;
      throw new Error(`List child records failed: ${res.status} ${text}`);
    }
    let items: ListItem[] = safeParse(text)?.items ?? [];
    if (i === attempts.length - 1) {
      items = items.filter((it) => {
        const parentVal = pick(it, FIELD_PARENT_CUSTOMER);
        const parentId =
          parentVal && typeof parentVal === "object" && parentVal.id != null
            ? Number(parentVal.id)
            : Number(parentVal);
        return parentId === nsId;
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
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const nsId = Number(body?.customerId);
  if (!Number.isFinite(nsId) || nsId <= 0)
    return NextResponse.json(
      { error: "customerId must be a positive number" },
      { status: 400 }
    );
  if (!Array.isArray(body?.preferences))
    return NextResponse.json(
      { error: "preferences must be an array" },
      { status: 400 }
    );

  const token = await getValidToken().catch((e: any) =>
    NextResponse.json(
      {
        error: "Failed to acquire NetSuite token",
        details: String(e?.message ?? e),
      },
      { status: 500 }
    )
  );
  if (typeof token !== "string") return token as any;

  const base = recordsBase();

  let existing: ListItem[];
  try {
    existing = await fetchChildList(base, token, nsId);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "List child records failed" },
      { status: 502 }
    );
  }

  const byEventId = new Map<string, number[]>();
  for (const it of existing) {
    const recId = Number(it.id ?? pick(it, "id"));
    const eventVal = pick(it, FIELD_EVENT_TYPE);
    const eventId =
      eventVal && typeof eventVal === "object" && eventVal.id != null
        ? String(eventVal.id)
        : String(eventVal);
    if (Number.isFinite(recId)) {
      const arr = byEventId.get(eventId) || [];
      arr.push(recId);
      byEventId.set(eventId, arr);
    }
  }

  const toCreate: any[] = [];
  const toUpdate: Array<{ id: number; body: any }> = [];

  for (const p of body.preferences as PrefIn[]) {
    const eventId = String(p.id);
    const explicitId = p.recordId != null ? Number(p.recordId) : undefined;
    const targetRecId =
      explicitId && Number.isFinite(explicitId)
        ? explicitId
        : (byEventId.get(eventId) || [])[0];

    if (p.subscribed) {
      if (targetRecId) {
        toUpdate.push({
          id: targetRecId,
          body: {
            [FIELD_ACTIVE]: true,
            [FIELD_LEAVE_DATE]: null,
            [FIELD_EMAIL]: !!p.email,
            [FIELD_SMS]: !!p.sms,
          },
        });
      } else {
        toCreate.push({
          [FIELD_PARENT_CUSTOMER]: { id: String(nsId) },
          [FIELD_EVENT_TYPE]: { id: String(eventId) },
          [FIELD_ACTIVE]: true,
          [FIELD_LEAVE_DATE]: null,
          [FIELD_EMAIL]: !!p.email,
          [FIELD_SMS]: !!p.sms,
        });
      }
    } else {
      if (targetRecId) {
        toUpdate.push({
          id: targetRecId,
          body: {
            [FIELD_ACTIVE]: false,
            [FIELD_LEAVE_DATE]: new Date().toISOString().slice(0, 10),
            [FIELD_EMAIL]: false,
            [FIELD_SMS]: false,
          },
        });
      }
    }
  }

  const results: any = { created: [], updated: [] };

  for (const rec of toCreate) {
    const r = await fetch(`${base}/${encodeURIComponent(CHILD_RECORD_TYPE)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation,transient",
      },
      body: JSON.stringify(rec),
    });
    const text = await r.text();
    if (!r.ok)
      return NextResponse.json(
        { error: "Create child failed", status: r.status, details: text },
        { status: 502 }
      );
    const parsed = safeParse(text);
    results.created.push(
      parsed ?? { id: idFromLocation(r.headers), raw: text || null }
    );
  }

  for (const rec of toUpdate) {
    const r = await fetch(
      `${base}/${encodeURIComponent(CHILD_RECORD_TYPE)}/${rec.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          Prefer: "return=representation,transient",
        },
        body: JSON.stringify(rec.body),
      }
    );
    const text = await r.text();
    if (!r.ok)
      return NextResponse.json(
        {
          error: "Update child failed",
          id: rec.id,
          status: r.status,
          details: text,
        },
        { status: 502 }
      );
    const parsed = safeParse(text);
    results.updated.push(parsed ?? { id: rec.id, raw: text || null });
  }

  let current: any[] = [];
  try {
    current = await fetchChildList(base, token, nsId);
  } catch {
    current = [];
  }

  return NextResponse.json(
    {
      ok: true,
      childType: CHILD_RECORD_TYPE,
      customerId: nsId,
      results,
      current,
    },
    { status: 200 }
  );
}
