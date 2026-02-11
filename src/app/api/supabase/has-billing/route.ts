// src/app/api/supabase/has-billing/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

function hasValue(v?: string | null) {
  return typeof v === "string" && v.trim().length > 0;
}

export async function GET(req: NextRequest) {
  try {
    const customerIdRaw =
      req.nextUrl.searchParams.get("customerId") ??
      req.nextUrl.searchParams.get("nsId");
    const customerId =
      customerIdRaw !== null && customerIdRaw !== undefined
        ? Number(customerIdRaw)
        : null;
    const hasValidCustomerId =
      customerId !== null && !Number.isNaN(customerId) && customerId !== -1;

    const supabase = await getServerSupabase();
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const selectFields = `
      billing_address1,
      billing_address2,
      billing_city,
      billing_state,
      billing_zip,
      billing_country
    `;

    let row: any = null;

    if (hasValidCustomerId) {
      const { data, error } = await supabase
        .from("customer_information")
        .select(selectFields)
        .eq("customer_id", customerId)
        .limit(1)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      row = data ?? null;
    }

    if (!row) {
      const { data, error } = await supabase
        .from("customer_information")
        .select(selectFields)
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      row = data ?? null;
    }

    const hasBilling =
      hasValue(row?.billing_address1) &&
      hasValue(row?.billing_city) &&
      hasValue(row?.billing_state) &&
      hasValue(row?.billing_zip) &&
      hasValue(row?.billing_country);

    return NextResponse.json({ hasBilling: Boolean(hasBilling) });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to check customer information" },
      { status: 500 }
    );
  }
}
