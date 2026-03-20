// src/app/api/sso/check-email/route.ts
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

const SHARED_SECRET = process.env.WP_SSO_SECRET!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const email = (searchParams.get("email") || "").trim().toLowerCase();
  const sig = searchParams.get("sig") || "";

  const expected = createHmac("sha256", SHARED_SECRET)
    .update(email)
    .digest("hex");
  if (!sig || sig !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!email) {
    return NextResponse.json(
      { ok: false, error: "Missing email" },
      { status: 400 },
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, exists: false },
        { status: 500 },
      );
    }

    const exists = data.users.some(
      (u) => (u.email ?? "").trim().toLowerCase() === email,
    );

    if (exists) {
      return NextResponse.json({ ok: true, exists: true });
    }

    if (data.users.length < perPage) {
      break;
    }

    page += 1;
  }

  return NextResponse.json({ ok: true, exists: false });
}
