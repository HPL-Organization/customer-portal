// src/app/api/auth/provision/route.ts
import { NextResponse, NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = null;
  try {
    body = await req.json();
  } catch {}
  const meta = (user.user_metadata as any) || {};

  const firstName = (body?.firstName ?? meta.first_name ?? "")
    .toString()
    .trim();
  const middleName = (body?.middleName ?? meta.middle_name ?? "")
    .toString()
    .trim();
  const lastName = (body?.lastName ?? meta.last_name ?? "").toString().trim();

  const emailLC = user.email.toLowerCase();

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: existing } = await admin
    .from("profiles")
    .select("netsuite_customer_id")
    .eq("user_id", user.id)
    .single();

  if (existing?.netsuite_customer_id) {
    return NextResponse.json({ nsId: String(existing.netsuite_customer_id) });
  }

  const { data: preloaded } = await admin
    .from("profiles")
    .select("profile_id, netsuite_customer_id")
    .eq("email", emailLC)
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (preloaded?.netsuite_customer_id) {
    const { error: claimErr } = await admin
      .from("profiles")
      .update({ user_id: user.id, email: emailLC, role: "customer" })
      .eq("profile_id", preloaded.profile_id)
      .is("user_id", null);

    if (!claimErr) {
      return NextResponse.json({
        nsId: String(preloaded.netsuite_customer_id),
      });
    }
  }

  const origin = req.nextUrl.origin;
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || emailLC;

  const r = await fetch(`${origin}/api/netsuite/create-customer-simple`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: fullName, email: emailLC, middleName }),
  });

  if (!r.ok) {
    return NextResponse.json(
      { nsId: null, error: "netsuite-create-failed" },
      { status: 200 }
    );
  }

  const created = await r.json().catch(() => ({} as any));
  const nsIdNum = Number(created?.id ?? created?.result?.id ?? null);
  if (!Number.isFinite(nsIdNum)) {
    return NextResponse.json(
      { nsId: null, error: "netsuite-id-missing" },
      { status: 200 }
    );
  }

  const { error: upsertErr } = await admin
    .from("profiles")
    .upsert(
      {
        user_id: user.id,
        email: emailLC,
        role: "customer",
        netsuite_customer_id: nsIdNum,
      },
      { onConflict: "email" }
    );

  if (upsertErr) {
    return NextResponse.json(
      { nsId: null, error: "profile-upsert-failed" },
      { status: 200 }
    );
  }

  return NextResponse.json({ nsId: String(nsIdNum) });
}
