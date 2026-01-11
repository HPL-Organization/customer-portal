export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { gateway } from "@/lib/braintree/braintree";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const NS_WRITES_URL =
  process.env.NS_WRITES_URL || "https://netsuite-writes.onrender.com";
const NS_WRITES_ADMIN_BEARER = process.env.NS_WRITES_ADMIN_BEARER || "test";

const CALLBACK_URL =
  process.env.NS_WRITES_PM_CALLBACK_URL ||
  "https://portal.hplapidary.com/api/callbacks/save-payment-method-callback"; //"https://daine-coffinless-otelia.ngrok-free.dev/api/callbacks/save-payment-method-callback" ||

const CALLBACK_SECRET =
  process.env.NSWRITES_WEBHOOK_SECRET ||
  process.env.PORTAL_CALLBACK_SECRET ||
  "";

function nowIso() {
  return new Date().toISOString();
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const nsCustomerId = body?.nsCustomerId;
  const amount = body?.amount;
  const invoiceId = body?.invoiceId ?? null;
  const nonce = body?.nonce ?? null;
  const paymentMethodToken = body?.paymentMethodToken ?? null;
  const vault = Boolean(body?.vault);

  const payerEmailFromClient: string | null =
    typeof body?.payerEmail === "string" && body.payerEmail.trim()
      ? body.payerEmail.trim()
      : null;

  if (!nsCustomerId)
    return NextResponse.json(
      { error: "nsCustomerId required" },
      { status: 400 }
    );
  if (!nonce && !paymentMethodToken)
    return NextResponse.json(
      { error: "nonce or paymentMethodToken required" },
      { status: 400 }
    );

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  if (vault && (!amount || Number(amount) <= 0)) {
    const result = await gateway.paymentMethod.create({
      customerId: String(nsCustomerId),
      paymentMethodNonce: nonce,
      options: { makeDefault: true },
    });
    if (!result.success)
      return NextResponse.json({ error: result.message }, { status: 422 });

    const pm = result.paymentMethod as any;
    const token = String(pm?.token || "");
    if (!token)
      return NextResponse.json(
        { error: "Vault succeeded but token missing" },
        { status: 500 }
      );

    const raw = JSON.parse(JSON.stringify(pm));

    const payerEmail: string | null =
      (typeof pm?.email === "string" && pm.email.trim()
        ? pm.email.trim()
        : null) ?? payerEmailFromClient;

    const processingId = `processing-${Date.now()}`;

    const row = {
      customer_id: Number(nsCustomerId),
      instrument_id: processingId,
      payment_method: "paypal",
      brand: "paypal",
      last4: null,
      expiry: null,
      token,
      token_family: "PayPal",
      token_namespace: "braintree",
      is_default: true,
      ns_deleted_at: null,
      last_seen_at: nowIso(),
      synced_at: nowIso(),
      raw,
      netsuite_writes_status: "processing" as const,
      payer_email: payerEmail,
    };

    let pi_id: string | null = null;

    const { data: inserted, error: insErr } = await supabase
      .from("payment_instruments")
      .insert([row])
      .select("pi_id")
      .single();

    if (insErr) {
      const { data: up, error: upErr } = await supabase
        .from("payment_instruments")
        .upsert([row], { onConflict: "customer_id,instrument_id" })
        .select("pi_id")
        .single();

      if (upErr) {
        console.error("Supabase PI write failed", insErr, upErr);
        return NextResponse.json(
          { error: "Supabase write failed" },
          { status: 500 }
        );
      }
      pi_id = up?.pi_id ?? null;
    } else {
      pi_id = inserted?.pi_id ?? null;
    }

    if (!pi_id) {
      return NextResponse.json(
        { error: "Supabase write failed (missing pi_id)" },
        { status: 500 }
      );
    }

    const idempotencyKey =
      process.env.FORCE_STATIC_IDEMPOTENCY === "1"
        ? `pm:${Number(nsCustomerId)}:${token}`
        : crypto.randomUUID();

    const nsRes = await fetch(
      `${NS_WRITES_URL.replace(/\/$/, "")}/api/netsuite/save-payment-method`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${NS_WRITES_ADMIN_BEARER}`,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          customerInternalId: Number(nsCustomerId),

          token,
          tokenFamily: "PayPal",

          cardNameOnCard: payerEmail || "PayPal",

          accountNumberLastFour: undefined,
          tokenExpirationDate: undefined,

          accountType: "paypal",

          clientRef: pi_id,

          callbackUrl: CALLBACK_URL,
          callbackMethod: "POST",
          callbackHeaders: { "x-source": "customer-portal" },
          callbackSecret: CALLBACK_SECRET,
        }),
      }
    );

    const nsText = await nsRes.text();
    let nsJson: any = {};
    try {
      nsJson = nsText ? JSON.parse(nsText) : {};
    } catch {
      nsJson = { raw: nsText };
    }

    if (!nsRes.ok || nsJson?.error) {
      await supabase
        .from("payment_instruments")
        .update({ netsuite_writes_status: "failed" })
        .eq("pi_id", pi_id);

      const message =
        nsJson?.message || nsJson?.error || `HTTP ${nsRes.status}: ${nsText}`;
      return NextResponse.json({ error: message }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      queued: true,
      pi_id,
      instrumentId: processingId,
      payerEmail,
    });
  }

  if (!amount || Number(amount) <= 0)
    return NextResponse.json(
      { error: "amount required for charge" },
      { status: 400 }
    );

  const saleReq: any = {
    amount: String(amount),
    options: {
      submitForSettlement: true,
      storeInVaultOnSuccess: Boolean(vault),
    },
    customerId: String(nsCustomerId),
  };
  if (nonce) saleReq.paymentMethodNonce = nonce;
  if (paymentMethodToken) saleReq.paymentMethodToken = paymentMethodToken;

  const result = await gateway.transaction.sale(saleReq);
  if (!result.success)
    return NextResponse.json({ error: result.message }, { status: 422 });

  const tx = result.transaction as any;

  await supabase.from("processor_payments").insert({
    customer_id: Number(nsCustomerId),
    invoice_id: invoiceId ? Number(invoiceId) : null,
    processor: "braintree",
    processor_transaction_id: tx.id,
    method: "paypal",
    amount: Number(tx.amount),
    currency: tx.currencyIsoCode || null,
    status: tx.status,
    payer_email: tx.paypalAccount?.payerEmail || null,
    raw: tx,
  });

  const vaultedToken = tx?.paypalAccount?.token as string | undefined;
  if (vaultedToken) {
    await supabase.from("payment_instruments").upsert(
      {
        customer_id: Number(nsCustomerId),
        instrument_id: vaultedToken,
        payment_method: "paypal",
        brand: "paypal",
        last4: null,
        expiry: null,
        token: vaultedToken,
        token_family: "Braintree",
        token_namespace: "braintree",
        is_default: true,
        payer_email: tx.paypalAccount?.payerEmail || null,
        raw: tx?.paypalAccount || tx,
      },
      { onConflict: "customer_id,instrument_id" }
    );
  }

  return NextResponse.json({
    ok: true,
    transactionId: tx.id,
    status: tx.status,
  });
}
