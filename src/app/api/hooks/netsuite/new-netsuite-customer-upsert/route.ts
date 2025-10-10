import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  const secret = req.headers.get("x-webhook-secret");
  if (secret !== process.env.NETSUITE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const emailRaw = String(body?.email ?? "").trim();
  const nsIdNum = Number(body?.netsuite_customer_id);

  if (!emailRaw || !Number.isFinite(nsIdNum)) {
    return NextResponse.json(
      { error: "email and netsuite_customer_id required" },
      { status: 400 }
    );
  }

  const email = emailRaw.toLowerCase();

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: existing } = await admin
    .from("profiles")
    .select("profile_id")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (existing?.profile_id) {
    const { error: updErr } = await admin
      .from("profiles")
      .update({ netsuite_customer_id: nsIdNum, role: "customer" })
      .eq("profile_id", existing.profile_id);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, mode: "updated" });
  }

  const { error: insErr } = await admin.from("profiles").insert({
    user_id: null,
    email,
    role: "customer",
    netsuite_customer_id: nsIdNum,
  });

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, mode: "inserted" });
}
