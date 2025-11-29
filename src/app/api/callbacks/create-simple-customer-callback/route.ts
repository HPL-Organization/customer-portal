// src/app/api/callbacks/create-simple-customer-callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

type CallbackBody = {
  email?: string;
  customerId?: number;
};

export async function POST(req: NextRequest) {
  let body: CallbackBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid-json" },
      { status: 400 }
    );
  }

  const email = (body.email || "").toLowerCase().trim();
  const customerId = body.customerId;

  if (!email || !customerId || typeof customerId !== "number") {
    return NextResponse.json(
      { ok: false, error: "missing-email-or-customerId" },
      { status: 400 }
    );
  }

  const { data, error } = await admin
    .from("profiles")
    .update({ netsuite_customer_id: customerId })
    .eq("email", email)
    .eq("netsuite_customer_id", -1)
    .select("profile_id, netsuite_customer_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "update-failed", details: error.message },
      { status: 500 }
    );
  }

  if (!data) {
    return NextResponse.json(
      { ok: true, mode: "no-op", reason: "no-matching-profile" },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      mode: "updated",
      email,
      customerId,
    },
    { status: 200 }
  );
}
