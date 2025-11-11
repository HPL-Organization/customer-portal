// app/api/supabase/get-customer-info/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const nsId = req.nextUrl.searchParams.get("nsId");
    if (!nsId) {
      return NextResponse.json({ error: "Missing nsId" }, { status: 400 });
    }

    const supabase = await getServerSupabase();

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("customer_information")
      .select(
        `
          info_id,
          customer_id,
          email,
          first_name,
          middle_name,
          last_name,
          phone,
          mobile,
          shipping_address1,
          shipping_address2,
          shipping_city,
          shipping_state,
          shipping_zip,
          shipping_country,
          billing_address1,
          billing_address2,
          billing_city,
          billing_state,
          billing_zip,
          billing_country,
          shipping_verified,
          billing_verified,
          terms_compliance,
          terms_agreed_at,
          user_id
        `
      )
      .eq("customer_id", Number(nsId))
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, data: data ?? null }, { status: 200 });
  } catch (e: any) {
    console.error("get-customer-info error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
