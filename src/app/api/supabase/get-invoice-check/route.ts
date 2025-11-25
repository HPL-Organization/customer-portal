// app/api/supabase/get-invoice-check/route.ts
import { NextResponse } from "next/server";
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

async function findInvoiceCheckRow(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  userId: string
) {
  const byUser = await supabase
    .from("customer_information")
    .select(
      "info_id, user_id, customer_id, check_invoice, check_invoice_range, check_invoice_result"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (!byUser.error && byUser.data) return byUser;

  const profile = await supabase
    .from("profiles")
    .select("netsuite_customer_id")
    .eq("user_id", userId)
    .single();

  if (profile.error || !profile.data?.netsuite_customer_id) {
    return { data: null, error: null } as const;
  }

  const byCustomer = await supabase
    .from("customer_information")
    .select(
      "info_id, user_id, customer_id, check_invoice, check_invoice_range, check_invoice_result"
    )
    .eq("customer_id", profile.data.netsuite_customer_id)
    .maybeSingle();

  return byCustomer;
}

export async function GET() {
  const supabase = await getServerSupabase();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await findInvoiceCheckRow(supabase, user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    exists: !!data,
    ...shapeInvoiceCheck(data ?? undefined),
  });
}
