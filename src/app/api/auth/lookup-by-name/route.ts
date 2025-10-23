import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function maskEmail(email: string) {
  const [user, domain] = email.split("@");
  const maskPart = (s: string) =>
    s.length <= 2
      ? s[0] + "*"
      : s[0] + "*".repeat(Math.max(1, s.length - 2)) + s[s.length - 1];
  const [d1, ...rest] = domain.split(".");
  return `${maskPart(user)}@${maskPart(d1)}.${rest.join(".")}`;
}

function eqCI(a?: string | null, b?: string | null) {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export async function POST(req: NextRequest) {
  try {
    const { firstName, lastName } = await req.json();
    if (!firstName || !lastName) {
      return NextResponse.json(
        { ok: false, error: "Missing names" },
        { status: 400 }
      );
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    let page = 1;
    const perPage = 200;
    let foundEmail: string | null = null;

    while (!foundEmail) {
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
        const meta = (u.user_metadata || u.raw_user_meta_data || {}) as Record<
          string,
          any
        >;
        if (
          eqCI(meta.first_name, firstName) &&
          eqCI(meta.last_name, lastName)
        ) {
          foundEmail = u.email ?? null;
          break;
        }
      }

      if (data.users.length < perPage) break;
      page += 1;
    }

    if (!foundEmail) {
      return NextResponse.json({ ok: true, exists: false });
    }

    return NextResponse.json({
      ok: true,
      exists: true,
      email: foundEmail,
      masked: maskEmail(foundEmail),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
