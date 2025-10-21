import { NextResponse } from "next/server";
import { savePaymentMethod } from "../../../../lib/netsuite/savePaymentMethod";
import { createClient } from "@supabase/supabase-js";

type SavePMBody = {
  customerInternalId?: number | string;
  token?: string;
  accountNumberLastFour?: string;
  accountType?: string;
  cardNameOnCard?: string;
  tokenExpirationDate?: string;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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

    const data = await savePaymentMethod(customerInternalIdNum, body.token, {
      accountNumberLastFour: body.accountNumberLastFour,
      accountType: body.accountType,
      cardNameOnCard: body.cardNameOnCard,
      tokenExpirationDate: body.tokenExpirationDate,
    });

    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const nowIso = new Date().toISOString();
      const paymentCardTokenId =
        (data as any)?.paymentCardTokenId ??
        (data as any)?.id ??
        (data as any)?.instrumentId ??
        body.token;

      const row = {
        customer_id: customerInternalIdNum,
        instrument_id: String(paymentCardTokenId),
        payment_method: "Payment Card Token",
        brand: body.accountType ?? null,
        last4: body.accountNumberLastFour ?? null,
        expiry: body.tokenExpirationDate ?? null,
        token: String(body.token),
        token_family: "Versapay",
        token_namespace: null,
        is_default: false,
        ns_deleted_at: null,
        last_seen_at: nowIso,
        synced_at: nowIso,
        raw: null,
      };

      const { error: upErr } = await supabase
        .from("payment_instruments")
        .upsert([row], { onConflict: "customer_id,instrument_id" });
      if (upErr) {
        console.error("Supabase upsert failed", upErr);
      }
    } catch (e) {
      console.error("Supabase write-through error", e);
    }

    return NextResponse.json(data, { status: 200 });
  } catch (err: unknown) {
    const error = err as {
      message?: string;
      status?: number;
      ns?: unknown;
      body?: unknown;
      stack?: string;
    };

    console.error("Error saving payment method", {
      message: error?.message ?? "",
      status: error?.status ?? "",
      ns: error?.ns ?? "",
      body: error?.body ?? "",
      stack: error?.stack ?? "",
    });

    return NextResponse.json(
      { error: "Failed to save payment method" },
      { status: 500 }
    );
  }
}
