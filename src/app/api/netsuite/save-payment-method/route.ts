import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const NS_WRITES_URL =
  process.env.NS_WRITES_URL || "https://netsuite-writes.onrender.com";

const NS_WRITES_ADMIN_BEARER = process.env.NS_WRITES_ADMIN_BEARER || "test";

const CALLBACK_URL =
  process.env.NS_WRITES_PM_CALLBACK_URL ||
  "https://portal.hplapidary.com/api/callbacks/save-payment-method-callback";
const CALLBACK_SECRET =
  process.env.NSWRITES_WEBHOOK_SECRET ||
  process.env.PORTAL_CALLBACK_SECRET ||
  "";

function nowIso() {
  return new Date().toISOString();
}

type SavePMBody = {
  customerInternalId?: number | string;
  token?: string;
  accountNumberLastFour?: string;
  accountType?: string;
  cardNameOnCard?: string;
  tokenExpirationDate?: string;
};

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as SavePMBody;

    const customerInternalIdNum = Number(body.customerInternalId);
    if (!Number.isFinite(customerInternalIdNum) || customerInternalIdNum <= 0) {
      return NextResponse.json(
        { error: "Invalid or missing customerInternalId" },
        { status: 400 }
      );
    }
    if (!body.token || typeof body.token !== "string") {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const instrumentIdTemp = null as string | null;
    const row = {
      customer_id: customerInternalIdNum,
      instrument_id:
        instrumentIdTemp ?? (`processing-${Date.now()}` as unknown as string),
      payment_method: "Payment Card Token",
      brand: body.accountType ?? null,
      last4: body.accountNumberLastFour ?? null,
      expiry: body.tokenExpirationDate ?? null,
      token: String(body.token),
      token_family: "Versapay",
      token_namespace: null,
      is_default: false,
      ns_deleted_at: null,
      last_seen_at: nowIso(),
      synced_at: nowIso(),
      raw: null,
      netsuite_writes_status: "processing" as const,
    };

    const { data: inserted, error: insErr } = await supabase
      .from("payment_instruments")
      .insert([row])
      .select("pi_id")
      .single();

    if (insErr) {
      const { data: up, error: upErr } = await supabase
        .from("payment_instruments")
        .upsert([row], { onConflict: "pi_id" })
        .select("pi_id")
        .single();
      if (upErr) {
        console.error("Supabase write failed", insErr, upErr);
        return NextResponse.json(
          { error: "Supabase write failed" },
          { status: 500 }
        );
      }
      (row as any).pi_id = up?.pi_id;
    } else {
      (row as any).pi_id = inserted?.pi_id;
    }

    const pi_id: string = (row as any).pi_id;

    const idempotencyKey =
      process.env.FORCE_STATIC_IDEMPOTENCY === "1"
        ? `pm:${customerInternalIdNum}:${body.token}`
        : crypto.randomUUID();

    const payload = {
      customerInternalId: customerInternalIdNum,
      token: body.token,
      accountNumberLastFour: body.accountNumberLastFour || null,
      accountType: body.accountType || null,
      cardNameOnCard: body.cardNameOnCard || null,
      tokenExpirationDate: body.tokenExpirationDate || null,

      callback_url: CALLBACK_URL,
      callback_secret: CALLBACK_SECRET || null,

      callback_payload: {
        pi_id,
      },
    };

    const res = await fetch(
      `${NS_WRITES_URL.replace(/\/$/, "")}/api/netsuite/save-payment-method`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${NS_WRITES_ADMIN_BEARER}`,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          customerInternalId: customerInternalIdNum,
          token: body.token,
          accountNumberLastFour: body.accountNumberLastFour || undefined,
          accountType: body.accountType || undefined,
          cardNameOnCard: body.cardNameOnCard || undefined,
          tokenExpirationDate: body.tokenExpirationDate || undefined,

          clientRef: (row as any).pi_id,

          callbackUrl: CALLBACK_URL,
          callbackMethod: "POST",
          callbackHeaders: { "x-source": "customer-portal" },
          callbackSecret: CALLBACK_SECRET,
        }),
      }
    );

    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    if (!res.ok || json?.error) {
      await supabase
        .from("payment_instruments")
        .update({ netsuite_writes_status: "failed" })
        .eq("pi_id", pi_id);

      const message =
        json?.message || json?.error || `HTTP ${res.status}: ${text}`;
      return NextResponse.json({ error: message }, { status: 502 });
    }

    return NextResponse.json(
      { ok: true, queued: true, pi_id },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Save PM enqueue error:", err);
    return NextResponse.json(
      { error: "Failed to enqueue save_payment_method" },
      { status: 500 }
    );
  }
}
