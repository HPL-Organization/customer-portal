import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

type InfoPayload = {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  shipping?: {
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  billing?: {
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  shippingVerified?: boolean;
  billingVerified?: boolean;
};

function toRow(
  payload: InfoPayload,
  customerId: number,
  fallbackEmail?: string,
  userId?: string
) {
  const {
    firstName,
    middleName,
    lastName,
    email,
    phone,
    mobile,
    shipping,
    billing,
    shippingVerified,
    billingVerified,
  } = payload;

  return {
    customer_id: customerId,
    email: (email ?? fallbackEmail) || null,

    first_name: firstName ?? null,
    middle_name: middleName ?? null,
    last_name: lastName ?? null,
    phone: phone ?? null,
    mobile: mobile ?? null,

    shipping_address1: shipping?.address1 ?? null,
    shipping_address2: shipping?.address2 ?? null,
    shipping_city: shipping?.city ?? null,
    shipping_state: shipping?.state ?? null,
    shipping_zip: shipping?.zip ?? null,
    shipping_country: shipping?.country ?? null,

    billing_address1: billing?.address1 ?? null,
    billing_address2: billing?.address2 ?? null,
    billing_city: billing?.city ?? null,
    billing_state: billing?.state ?? null,
    billing_zip: billing?.zip ?? null,
    billing_country: billing?.country ?? null,

    shipping_verified: !!shippingVerified,
    billing_verified: !!billingVerified,

    user_id: userId ?? null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body: InfoPayload = await req.json();

    const supabase = await getServerSupabase();

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("netsuite_customer_id,email")
      .eq("user_id", user.id)
      .single();

    if (profErr || !profile?.netsuite_customer_id) {
      return NextResponse.json(
        { error: "Profile not found for user" },
        { status: 400 }
      );
    }

    const customerIdNum = Number(profile.netsuite_customer_id);

    let conflictTarget: "customer_id" | "user_id" = "customer_id";

    if (customerIdNum === -1) {
      conflictTarget = "user_id";
    } else {
      const { data: existingByUser } = await supabase
        .from("customer_information")
        .select("info_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (existingByUser) {
        conflictTarget = "user_id";
      }
    }

    const row = toRow(body, customerIdNum, profile.email ?? undefined, user.id);

    const { data: saved, error: upErr } = await supabase
      .from("customer_information")
      .upsert(row, { onConflict: conflictTarget })
      .select()
      .single();

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, data: saved });
  } catch (e: any) {
    console.error("save-customer-info error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
