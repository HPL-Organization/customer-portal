export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { gateway } from "@/lib/braintree/braintree";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const nsCustomerId = body?.nsCustomerId;
  const amount = body?.amount;
  const invoiceId = body?.invoiceId ?? null;
  const nonce = body?.nonce ?? null;
  const paymentMethodToken = body?.paymentMethodToken ?? null;
  const vault = Boolean(body?.vault);

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

  const supabase = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false } }
  );

  if (vault && (!amount || Number(amount) <= 0)) {
    const result = await gateway.paymentMethod.create({
      customerId: String(nsCustomerId),
      paymentMethodNonce: nonce,
      options: { makeDefault: true },
    });
    if (!result.success)
      return NextResponse.json({ error: result.message }, { status: 422 });

    const pm = result.paymentMethod as any;
    const token = pm?.token as string;
    const raw = JSON.parse(JSON.stringify(pm));

    await supabase
      .from("payment_instruments")
      .upsert({
        customer_id: Number(nsCustomerId),
        instrument_id: token,
        payment_method: "paypal",
        brand: "paypal",
        last4: null,
        expiry: null,
        token: token,
        token_family: "paypal",
        token_namespace: "braintree",
        is_default: true,
        raw,
      })
      .select()
      .single();

    return NextResponse.json({ ok: true, vaultedToken: token });
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
    payer_email: tx.paypal?.payerEmail || null,
    raw: tx,
  });

  const vaultedToken = tx?.paypal?.token as string | undefined;
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
        token_family: "paypal",
        token_namespace: "braintree",
        is_default: true,
        raw: tx?.paypal || tx,
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
