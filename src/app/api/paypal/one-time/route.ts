/**
 * Summary:
 * - Creates and emails a PayPal invoice for a one-time payment.
 * - Uses PayPal OAuth (client_credentials) + Invoicing v2.
 * - Handles PayPal "link-only" 201 responses by extracting invoice id from href/Location.
 * - Writes PayPal invoice id/status/url/errors back to Supabase invoices table.
 */
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

function localDateYYYYMMDD(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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
      Accept: "application/json",
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

function pickLink(links: any, rels: string[]) {
  if (!Array.isArray(links)) return null;
  const hit = links.find((l) => rels.includes(String(l?.rel || "")));
  return hit?.href ? String(hit.href) : null;
}

function extractInvoiceIdFromHref(href?: string | null) {
  if (!href) return null;
  const m = String(href).match(/\/v2\/invoicing\/invoices\/([^/?#]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const nsCustomerId = body?.nsCustomerId;
    const invoiceId = Number(body?.invoiceId);
    const amountNum = Number(body?.amount);
    const payerEmailFromClient: string | null =
      typeof body?.payerEmail === "string" && body.payerEmail.trim()
        ? body.payerEmail.trim()
        : null;

    if (!nsCustomerId) {
      return NextResponse.json(
        { error: "nsCustomerId required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
      return NextResponse.json(
        { error: "invoiceId required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { error: "amount must be > 0" },
        { status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const { data: invoiceRow, error: invErr } = await supabase
      .from("invoices")
      .select(
        "invoice_id, tran_id, total, tax_total, amount_remaining, customer_id, paypal_invoice_id, paypal_payment_status"
      )
      .eq("invoice_id", invoiceId)
      .maybeSingle();

    if (invErr || !invoiceRow) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    if (
      nsCustomerId &&
      Number(invoiceRow.customer_id) !== Number(nsCustomerId)
    ) {
      return NextResponse.json(
        { error: "Invoice customer mismatch" },
        { status: 400 }
      );
    }

    const remaining = Number(invoiceRow.amount_remaining ?? 0);
    if (remaining > 0 && amountNum - remaining > 0.01) {
      return NextResponse.json(
        { error: "Amount exceeds remaining balance" },
        { status: 400 }
      );
    }

    const existingStatus = String(
      invoiceRow.paypal_payment_status ?? ""
    ).toLowerCase();
    if (
      invoiceRow.paypal_invoice_id &&
      (existingStatus === "sent" || existingStatus === "paid")
    ) {
      return NextResponse.json(
        {
          ok: true,
          existing: true,
          paypalInvoiceId: invoiceRow.paypal_invoice_id,
          paypalPaymentStatus: existingStatus,
        },
        { status: 200 }
      );
    }

    const { data: customerInfo } = await supabase
      .from("customer_information")
      .select("email, first_name, last_name")
      .eq("customer_id", invoiceRow.customer_id)
      .maybeSingle();

    const payerEmail =
      (customerInfo?.email && String(customerInfo.email).trim()) ||
      payerEmailFromClient ||
      null;

    if (!payerEmail) {
      return NextResponse.json(
        { error: "Customer email required for PayPal invoice" },
        { status: 400 }
      );
    }

    const invoiceNumber =
      invoiceRow.tran_id != null && String(invoiceRow.tran_id).trim()
        ? String(invoiceRow.tran_id).trim()
        : String(invoiceId);

    const idemKey =
      req.headers.get("Idempotency-Key") ||
      req.headers.get("idempotency-key") ||
      `pp-inv:${invoiceId}:${crypto.randomUUID()}`;

    const accessToken = await getPayPalAccessToken();

    const firstName =
      customerInfo?.first_name != null ? String(customerInfo.first_name) : "";
    const lastName =
      customerInfo?.last_name != null ? String(customerInfo.last_name) : "";

    const recipient: any = {
      billing_info: {
        email_address: payerEmail,
      },
    };

    if (firstName.trim() || lastName.trim()) {
      recipient.billing_info.name = {
        given_name: firstName.trim() || undefined,
        surname: lastName.trim() || undefined,
      };
    }

    const createPayload: any = {
      detail: {
        invoice_number: invoiceNumber,
        currency_code: "USD",
        reference: `portal:${invoiceId}`,
        memo: `Portal invoice ${invoiceNumber}`,
        invoice_date: localDateYYYYMMDD(),
      },
      primary_recipients: [recipient],
      items: [
        {
          name: `Invoice ${invoiceNumber}`,
          quantity: "1",
          unit_amount: {
            currency_code: "USD",
            value: amountNum.toFixed(2),
          },
        },
      ],
    };

    const createRes = await fetch(`${PAYPAL_API_BASE}/v2/invoicing/invoices`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "PayPal-Request-Id": String(idemKey),
      },
      body: JSON.stringify(createPayload),
    });

    const createText = await createRes.text();
    let createJson: any = {};
    try {
      createJson = createText ? JSON.parse(createText) : {};
    } catch {
      createJson = { raw: createText };
    }

    const paypalInvoiceId =
      (createJson?.id && String(createJson.id)) ||
      extractInvoiceIdFromHref(createJson?.href) ||
      extractInvoiceIdFromHref(createRes.headers.get("location"));

    if (!createRes.ok || !paypalInvoiceId) {
      const message =
        createJson?.message ||
        createJson?.error_description ||
        `HTTP ${createRes.status}: ${createText}`;
      return NextResponse.json(
        { error: `PayPal invoice create failed: ${message}` },
        { status: 502 }
      );
    }

    const sendRes = await fetch(
      `${PAYPAL_API_BASE}/v2/invoicing/invoices/${encodeURIComponent(
        paypalInvoiceId
      )}/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "PayPal-Request-Id": `${idemKey}-send`,
        },
        body: JSON.stringify({ send_to_recipient: true }),
      }
    );

    const sendText = await sendRes.text();
    let sendJson: any = {};
    try {
      sendJson = sendText ? JSON.parse(sendText) : {};
    } catch {
      sendJson = { raw: sendText };
    }

    if (!sendRes.ok) {
      const paypalInvoiceUrl =
        pickLink(createJson?.links, ["payer_view", "self"]) ||
        pickLink(sendJson?.links, ["payer_view", "self"]) ||
        (createJson?.href ? String(createJson.href) : null);

      await supabase
        .from("invoices")
        .update({
          paypal_invoice_id: paypalInvoiceId,
          paypal_payment_status: "draft",
          paypal_invoice_status: createJson?.status ?? null,
          paypal_invoice_url: paypalInvoiceUrl,
          paypal_error:
            sendJson?.message ||
            sendJson?.error_description ||
            `HTTP ${sendRes.status}: ${sendText}`,
          payment_processing: true,
          paypal_create_idempotency_key: String(idemKey),
        })
        .eq("invoice_id", invoiceId);

      return NextResponse.json(
        {
          error:
            sendJson?.message ||
            sendJson?.error_description ||
            "PayPal invoice created but failed to send",
        },
        { status: 502 }
      );
    }

    const paypalInvoiceUrl =
      pickLink(createJson?.links, ["payer_view", "self"]) ||
      pickLink(sendJson?.links, ["payer_view", "self"]) ||
      (createJson?.href ? String(createJson.href) : null);

    await supabase
      .from("invoices")
      .update({
        paypal_invoice_id: paypalInvoiceId,
        paypal_payment_status: "sent",
        paypal_invoice_status: createJson?.status ?? sendJson?.status ?? null,
        paypal_invoice_url: paypalInvoiceUrl,
        paypal_sent_at: new Date().toISOString(),
        paypal_error: null,
        payment_processing: true,
        paypal_create_idempotency_key: String(idemKey),
      })
      .eq("invoice_id", invoiceId);

    return NextResponse.json(
      {
        ok: true,
        paypalInvoiceId,
        paypalPaymentStatus: "sent",
        payerEmail,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "PayPal invoice creation failed" },
      { status: 500 }
    );
  }
}
