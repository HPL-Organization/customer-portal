// src/app/api/netsuite/record-payment/route.ts
import { NextRequest } from "next/server";
import { recordPaymentForInvoice } from "@/lib/netsuite/recordPayment";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      invoiceInternalId,
      amount,
      undepFunds = true,
      accountId,
      paymentMethodId,
      paymentOptionId,
      trandate,
      memo,
      externalId,
      exchangeRate,
      extraFields,
    } = body || {};

    if (!invoiceInternalId) {
      return new Response(
        JSON.stringify({ error: "Missing invoiceInternalId" }),
        { status: 400 }
      );
    }
    if (!(Number(amount) > 0)) {
      return new Response(JSON.stringify({ error: "Amount must be > 0" }), {
        status: 400,
      });
    }

    const result = await recordPaymentForInvoice(Number(invoiceInternalId), {
      amount: Number(amount),
      undepFunds: Boolean(undepFunds),
      accountId: accountId != null ? Number(accountId) : undefined,
      paymentMethodId:
        paymentMethodId != null ? Number(paymentMethodId) : undefined,
      paymentOptionId:
        paymentOptionId != null ? Number(paymentOptionId) : undefined,
      trandate,
      memo,
      externalId,
      exchangeRate: typeof exchangeRate === "number" ? exchangeRate : undefined,
      extraFields,
    });

    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200,
    });
  } catch (e: any) {
    const status = e?.status || 500;
    const message = e?.message || "Failed to record payment";
    const details = e?.payload || undefined;
    return new Response(
      JSON.stringify({ success: false, error: message, details }),
      {
        status,
      }
    );
  }
}
