// src/app/api/auth/me/route.ts
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ user: null });

  const { data: profile } = await supabase
    .from("profiles")
    .select("netsuite_customer_id, role, email")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({
    user: { id: user.id, email: user.email },
    profile,
  });
}
