// src/app/api/netsuite/record-payment/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";

const NS_WRITES_URL =
  process.env.NS_WRITES_URL || "https://netsuite-writes.onrender.com";
const NS_WRITES_CLIENT_BEARER = process.env.NS_WRITES_ADMIN_BEARER;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const invoiceInternalId = Number(
      body?.invoiceInternalId ?? body?.invoiceId
    );
    const amount = Number(body?.amount);

    if (!Number.isFinite(invoiceInternalId) || invoiceInternalId <= 0) {
      return NextResponse.json(
        { error: "Missing or invalid invoiceInternalId" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Amount must be > 0" },
        { status: 400 }
      );
    }

    const payload = {
      invoiceInternalId,
      amount,
      undepFunds: body?.undepFunds ?? true,
      accountId: body?.accountId ?? undefined,
      paymentMethodId: body?.paymentMethodId ?? undefined,
      paymentOptionId: body?.paymentOptionId ?? undefined,
      trandate: body?.trandate ?? undefined,
      memo: body?.memo ?? undefined,
      externalId: body?.externalId ?? undefined,
      exchangeRate: body?.exchangeRate ?? undefined,
      extraFields: body?.extraFields ?? undefined,
    };

    const incomingIdem =
      req.headers.get("Idempotency-Key") || req.headers.get("idempotency-key");
    const idempotencyKey =
      incomingIdem ||
      `rp:${invoiceInternalId}:${amount}:${new Date()
        .toISOString()
        .slice(0, 10)}:${crypto.randomUUID()}`;

    const res = await fetch(`${NS_WRITES_URL}/api/netsuite/record-payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NS_WRITES_CLIENT_BEARER}`,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    if (!res.ok || json?.error) {
      const message =
        json?.message || json?.error || `HTTP ${res.status}: ${text}`;
      return NextResponse.json({ error: message }, { status: 502 });
    }

    return NextResponse.json(
      { ok: true, queued: true, jobId: json.jobId ?? null },
      { status: 202 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "enqueue failed" },
      { status: 500 }
    );
  }
}
