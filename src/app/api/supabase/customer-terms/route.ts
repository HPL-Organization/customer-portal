import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function shape(data?: {
  terms_compliance?: boolean | null;
  terms_agreed_at?: string | null;
}) {
  return {
    terms_compliance: !!data?.terms_compliance,
    terms_agreed_at: data?.terms_agreed_at ?? null,
  };
}

async function findTermsRow(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  userId: string
) {
  const byUser = await supabase
    .from("customer_information")
    .select("info_id, user_id, customer_id, terms_compliance, terms_agreed_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!byUser.error && byUser.data) return byUser;

  const profile = await supabase
    .from("profiles")
    .select("netsuite_customer_id")
    .eq("user_id", userId)
    .single();

  if (profile.error || !profile.data?.netsuite_customer_id)
    return { data: null, error: null } as const;

  const byCustomer = await supabase
    .from("customer_information")
    .select("info_id, user_id, customer_id, terms_compliance, terms_agreed_at")
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

  const { data, error } = await findTermsRow(supabase, user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    exists: !!data,
    ...shape(data ?? undefined),
  });
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
  const agree: boolean = !!body?.agree;
  let agreedAt: string | null =
    typeof body?.agreedAt === "string" && body.agreedAt.trim()
      ? new Date(body.agreedAt).toISOString()
      : null;

  if (agree && !agreedAt) agreedAt = new Date().toISOString();
  if (!agree) agreedAt = null;

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

  const updated = await supabase
    .from("customer_information")
    .update({ terms_compliance: agree, terms_agreed_at: agreedAt })
    .eq("user_id", user.id)
    .select("terms_compliance, terms_agreed_at")
    .maybeSingle();

  if (!updated.error && updated.data) {
    return NextResponse.json({ ok: true, ...shape(updated.data) });
  }

  const upsert = await supabase
    .from("customer_information")
    .upsert(
      {
        user_id: user.id,
        customer_id: Number(profile.data.netsuite_customer_id),
        email: profile.data.email ?? null,
        terms_compliance: agree,
        terms_agreed_at: agreedAt,
      },
      { onConflict: "user_id" }
    )
    .select("terms_compliance, terms_agreed_at")
    .single();

  if (upsert.error) {
    return NextResponse.json({ error: upsert.error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, ...shape(upsert.data) });
}
