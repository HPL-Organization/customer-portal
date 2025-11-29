// app/api/supabase/get-customer-info/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const nsIdRaw = req.nextUrl.searchParams.get("nsId");

    const supabase = await getServerSupabase();

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const nsIdNum =
      nsIdRaw !== null && nsIdRaw !== undefined ? Number(nsIdRaw) : null;
    const hasValidCustomerId =
      nsIdNum !== null && !Number.isNaN(nsIdNum) && nsIdNum !== -1;

    if (!hasValidCustomerId) {
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
          user_id,
          hubspot_id
        `
        )
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json(
        { ok: true, data: data ?? null },
        { status: 200 }
      );
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
          user_id,
          hubspot_id
        `
      )
      .eq("customer_id", nsIdNum)
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (data) {
      return NextResponse.json(
        { ok: true, data: data ?? null },
        { status: 200 }
      );
    }

    const { data: byUserId, error: byUserErr } = await supabase
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
          user_id,
          hubspot_id
        `
      )
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (byUserErr) {
      return NextResponse.json({ error: byUserErr.message }, { status: 400 });
    }

    return NextResponse.json(
      { ok: true, data: byUserId ?? null },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("get-customer-info error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
