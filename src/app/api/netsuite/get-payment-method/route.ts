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

    const { data, error } = await supabase
      .from("payment_instruments")
      .select(
        "instrument_id, payment_method, brand, last4, expiry, token_family, token_namespace, is_default, netsuite_writes_status"
      )
      .eq("customer_id", Number(customerInternalId))
      .is("ns_deleted_at", null)
      .order("is_default", { ascending: false })
      .order("instrument_id", { ascending: true });

    if (error) {
      return NextResponse.json(
        { success: false, message: "Failed to load payment methods" },
        { status: 500 }
      );
    }

    const instruments = (data || []).map((r) => ({
      id: r.instrument_id,
      paymentMethod: r.payment_method ?? "Card Token",
      brand: r.brand ?? null,
      last4: r.last4 ?? null,
      expiry: r.expiry ?? null,
      tokenFamily: r.token_family ?? null,
      tokenNamespace: r.token_namespace ?? null,
      isDefault: !!r.is_default,
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
