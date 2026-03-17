export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const PAYPAL_API_BASE =
  process.env.PAYPAL_API_BASE || "https://api-m.paypal.com";
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
const PAYPAL_WEBHOOK_SKIP_VERIFY =
  process.env.PAYPAL_WEBHOOK_SKIP_VERIFY === "1";

const NS_WRITES_URL =
  process.env.NS_WRITES_URL || "https://netsuite-writes.onrender.com";
const NS_WRITES_ADMIN_BEARER = process.env.NS_WRITES_ADMIN_BEARER || "test";
const NS_PAYPAL_ONE_TIME_PAYMENT_METHOD_ID = Number(
  process.env.NS_PAYPAL_ONE_TIME_PAYMENT_METHOD_ID
);

async function getPayPalAccessToken() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error("PayPal credentials missing");
  }
  const auth = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
  ).toString("base64");
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok || !json?.access_token) {
    const message =
      json?.error_description || json?.error || `HTTP ${res.status}: ${text}`;
    throw new Error(`PayPal auth failed: ${message}`);
  }
  return String(json.access_token);
}

async function verifyWebhookSignature(payload: any, headers: Headers) {
  if (PAYPAL_WEBHOOK_SKIP_VERIFY) return true;
  if (!PAYPAL_WEBHOOK_ID) {
    throw new Error("PAYPAL_WEBHOOK_ID missing");
  }
  const transmissionId = headers.get("paypal-transmission-id");
  const transmissionTime = headers.get("paypal-transmission-time");
  const transmissionSig = headers.get("paypal-transmission-sig");
  const certUrl = headers.get("paypal-cert-url");
  const authAlgo = headers.get("paypal-auth-algo");

  if (
    !transmissionId ||
    !transmissionTime ||
    !transmissionSig ||
    !certUrl ||
    !authAlgo
  ) {
    return false;
  }

  const accessToken = await getPayPalAccessToken();
  const res = await fetch(
    `${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transmission_id: transmissionId,
        transmission_time: transmissionTime,
        cert_url: certUrl,
        auth_algo: authAlgo,
        transmission_sig: transmissionSig,
        webhook_id: PAYPAL_WEBHOOK_ID,
        webhook_event: payload,
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
  return res.ok && String(json?.verification_status).toUpperCase() === "SUCCESS";
}

function readAmount(resource: any, fallback: number) {
  const candidates = [
    resource?.amount?.value,
    resource?.amount?.total?.value,
    resource?.amount?.gross_amount?.value,
    resource?.amount?.due_amount?.value,
    resource?.due_amount?.value,
  ];
  for (const v of candidates) {
    const num = Number(v);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return fallback;
}

function localDateYYYYMMDD(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  let payload: any = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!payload) {
    return NextResponse.json({ error: "missing payload" }, { status: 400 });
  }

  try {
    const verified = await verifyWebhookSignature(payload, req.headers);
    if (!verified) {
      return NextResponse.json({ error: "bad signature" }, { status: 401 });
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "verification failed" },
      { status: 401 }
    );
  }

  const eventType = String(payload?.event_type || "");
  if (eventType !== "INVOICING.INVOICE.PAID") {
    return NextResponse.json({ ok: true });
  }

  const resource = payload?.resource || {};
  const paypalInvoiceId = String(resource?.id || resource?.invoice_id || "");
  if (!paypalInvoiceId) {
    return NextResponse.json(
      { error: "missing PayPal invoice id" },
      { status: 400 }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const { data: invoiceRow, error: invErr } = await supabase
    .from("invoices")
    .select(
      "invoice_id, amount_remaining, total, paypal_last_event_id, paypal_payment_status"
    )
    .eq("paypal_invoice_id", paypalInvoiceId)
    .maybeSingle();
  if (invErr || !invoiceRow) {
    return NextResponse.json({ ok: true });
  }

  const eventId = String(payload?.id || "");
  if (eventId && invoiceRow.paypal_last_event_id === eventId) {
    return NextResponse.json({ ok: true });
  }

  const fallbackAmount =
    Number(invoiceRow.amount_remaining ?? 0) ||
    Number(invoiceRow.total ?? 0) ||
    0;
  const amountNum = readAmount(resource, fallbackAmount);

  if (
    !Number.isFinite(NS_PAYPAL_ONE_TIME_PAYMENT_METHOD_ID) ||
    NS_PAYPAL_ONE_TIME_PAYMENT_METHOD_ID <= 0
  ) {
    return NextResponse.json(
      {
        error:
          "Server misconfigured: NS_PAYPAL_ONE_TIME_PAYMENT_METHOD_ID missing/invalid",
      },
      { status: 500 }
    );
  }

  const idemKey = `pp-inv:${invoiceRow.invoice_id}:${
    eventId || crypto.randomUUID()
  }`;

  const nsRes = await fetch(
    `${NS_WRITES_URL.replace(/\/$/, "")}/api/netsuite/record-payment`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NS_WRITES_ADMIN_BEARER}`,
        "Idempotency-Key": idemKey,
      },
      body: JSON.stringify({
        invoiceInternalId: Number(invoiceRow.invoice_id),
        amount: amountNum,
        undepFunds: true,
        paymentMethodId: NS_PAYPAL_ONE_TIME_PAYMENT_METHOD_ID,
        memo: `Portal PayPal Invoice ${paypalInvoiceId}`,
        externalId: `PPINV_${paypalInvoiceId}`,
        trandate: localDateYYYYMMDD(),
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
    const message =
      nsJson?.message || nsJson?.error || `HTTP ${nsRes.status}: ${nsText}`;
    await supabase
      .from("invoices")
      .update({
        paypal_payment_status: "paid",
        paypal_invoice_status: resource?.status ?? null,
        paypal_error: message,
        payment_processing: true,
      })
      .eq("invoice_id", Number(invoiceRow.invoice_id));

    return NextResponse.json(
      { error: `NetSuite record-payment failed: ${message}` },
      { status: 502 }
    );
  }

  await supabase
    .from("invoices")
    .update({
      paypal_payment_status: "paid",
      paypal_invoice_status: resource?.status ?? null,
      paypal_paid_at: new Date().toISOString(),
      paypal_last_event_id: eventId || null,
      paypal_error: null,
      payment_processing: true,
    })
    .eq("invoice_id", Number(invoiceRow.invoice_id));

  return NextResponse.json({ ok: true, invoiceId: invoiceRow.invoice_id });
}
