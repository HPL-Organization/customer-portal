// app/api/supabase/set-invoice-check/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function shapeInvoiceCheck(data?: {
  check_invoice?: boolean | null;
  check_invoice_range?: any | null;
  check_invoice_result?: boolean | null;
}) {
  return {
    check_invoice: !!data?.check_invoice,
    check_invoice_range: data?.check_invoice_range ?? null,
    check_invoice_result:
      typeof data?.check_invoice_result === "boolean"
        ? data.check_invoice_result
        : null,
  };
}

export async function POST(req: NextRequest) {
  const supabase = await getServerSupabase();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));

  let result: boolean | null = null;
  let hasResult = false;

  if (typeof body?.checkInvoiceResult === "boolean") {
    result = body.checkInvoiceResult;
    hasResult = true;
  } else if (
    body &&
    Object.prototype.hasOwnProperty.call(body, "checkInvoiceResult") &&
    body.checkInvoiceResult === null
  ) {
    result = null;
    hasResult = true;
  }

  if (!hasResult) {
    return NextResponse.json(
      { error: "Missing checkInvoiceResult in request body" },
      { status: 400 }
    );
  }

  const profile = await supabase
    .from("profiles")
    .select("netsuite_customer_id, email")
    .eq("user_id", user.id)
    .single();

  if (profile.error || !profile.data?.netsuite_customer_id) {
    return NextResponse.json(
      { error: "Profile not found for user" },
      { status: 400 }
    );
  }

  const updatedByUser = await supabase
    .from("customer_information")
    .update({ check_invoice_result: result })
    .eq("user_id", user.id)
    .select("check_invoice, check_invoice_range, check_invoice_result")
    .maybeSingle();

  if (!updatedByUser.error && updatedByUser.data) {
    return NextResponse.json({
      ok: true,
      ...shapeInvoiceCheck(updatedByUser.data),
    });
  }

  const updatedByCustomer = await supabase
    .from("customer_information")
    .update({
      check_invoice_result: result,
      user_id: user.id,
    })
    .eq("customer_id", Number(profile.data.netsuite_customer_id))
    .is("user_id", null)
    .select("check_invoice, check_invoice_range, check_invoice_result")
    .maybeSingle();

  if (!updatedByCustomer.error && updatedByCustomer.data) {
    return NextResponse.json({
      ok: true,
      ...shapeInvoiceCheck(updatedByCustomer.data),
    });
  }

  return NextResponse.json({
    ok: false,
    error: "No customer_information row found for this user/customer",
  });
}
