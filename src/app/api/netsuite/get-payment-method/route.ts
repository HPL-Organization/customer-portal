import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: Request) {
  try {
    const { customerInternalId } = await req.json();

    if (!customerInternalId || !Number.isFinite(Number(customerInternalId))) {
      return NextResponse.json(
        { success: false, message: "customerInternalId is required" },
        { status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const customerId = Number(customerInternalId);

    const [{ data: methods, error }, { data: customerInfo, error: customerError }] =
      await Promise.all([
        supabase
          .from("payment_instruments")
          .select(
            "instrument_id, payment_method, brand, last4, expiry, token_family, token_namespace, is_default, netsuite_writes_status, payer_email"
          )
          .eq("customer_id", customerId)
          .is("ns_deleted_at", null)
          .order("is_default", { ascending: false })
          .order("instrument_id", { ascending: true }),
        supabase
          .from("customer_information")
          .select("express_pay")
          .eq("customer_id", customerId)
          .limit(1)
          .maybeSingle(),
      ]);

    if (error || customerError) {
      return NextResponse.json(
        { success: false, message: "Failed to load payment methods" },
        { status: 500 }
      );
    }

    const expressPayInstrumentId =
      customerInfo?.express_pay == null || String(customerInfo.express_pay).trim() === ""
        ? null
        : String(customerInfo.express_pay).trim();

    const sortedMethods = [...(methods || [])].sort((a, b) => {
      const aPreferred =
        expressPayInstrumentId != null &&
        String(a.instrument_id) === expressPayInstrumentId;
      const bPreferred =
        expressPayInstrumentId != null &&
        String(b.instrument_id) === expressPayInstrumentId;
      if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
      return String(a.instrument_id).localeCompare(String(b.instrument_id));
    });

    const instruments = sortedMethods.map((r) => ({
      id: r.instrument_id,
      paymentMethod: r.payment_method ?? "Card Token",
      brand: r.brand ?? null,
      last4: r.last4 ?? null,
      expiry: r.expiry ?? null,
      tokenFamily: r.token_family ?? null,
      tokenNamespace: r.token_namespace ?? null,
      payerEmail: r.payer_email ?? null,
      isDefault: !!r.is_default,
      preferredAutopayMethod:
        expressPayInstrumentId != null &&
        String(r.instrument_id) === expressPayInstrumentId,
      netsuite_writes_status: r.netsuite_writes_status ?? null,
      instrument_id: r.instrument_id,
    }));

    return NextResponse.json({ success: true, instruments }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: "Failed to fetch payment methods" },
      { status: 500 }
    );
  }
}
