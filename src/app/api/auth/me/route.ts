// src/app/api/auth/me/route.ts
import { getServerSupabase } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Check for admin cookies
  const impCookie = req.cookies.get("imp")?.value;
  const nsIdCookie = req.cookies.get("nsId")?.value;
  const isAdmin = impCookie === "1" && !!nsIdCookie;

  if (!user && !isAdmin) return NextResponse.json({ user: null, isAdmin: false });

  let profile = null;
  if (user) {
    const { data: profileData } = await supabase
      .from("profiles")
      .select("netsuite_customer_id, role, email")
      .eq("user_id", user.id)
      .single();
    profile = profileData;
  }

  return NextResponse.json({
    user: user ? { id: user.id, email: user.email } : null,
    profile,
    isAdmin,
  });
}
