// src/app/api/auth/check-email/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json(
        { ok: false, error: "Missing email" },
        { status: 400 }
      );
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const emailClean = String(email).trim().toLowerCase();

    let page = 1;
    const perPage = 200;
    let found: any | null = null;

    while (!found) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage,
      });
      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 500 }
        );
      }
      if (!data.users.length) break;

      for (const u of data.users) {
        const uEmail = (u.email ?? "").trim().toLowerCase();
        if (uEmail === emailClean) {
          found = u;
          break;
        }
      }

      if (data.users.length < perPage) break;
      page += 1;
    }

    if (!found) {
      return NextResponse.json({ ok: true, exists: false });
    }

    const confirmed =
      Boolean((found as any).email_confirmed_at) ||
      Boolean((found as any).confirmed_at);

    return NextResponse.json({
      ok: true,
      exists: true,
      confirmed,
      masked: maskEmail(found.email ?? emailClean),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}

function maskEmail(e: string) {
  const [u, d] = e.split("@");
  if (!u || !d) return e;
  const head = u.slice(0, 2);
  const tail = u.length > 2 ? u.slice(-1) : "";
  return `${head}${"*".repeat(
    Math.max(1, u.length - head.length - tail.length)
  )}${tail}@${d}`;
}
