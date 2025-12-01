import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function eqCI(a?: string | null, b?: string | null) {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { ok: false, error: "Missing or invalid email" },
        { status: 400 }
      );
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    let page = 1;
    const perPage = 200;
    let foundUser: any = null;

    while (!foundUser) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage,
      });

      if (error) {
        console.error("[CHECK_CONFIRMED_ADMIN_ERROR]", {
          message: error.message,
          name: error.name,
          raw: error,
        });
        return NextResponse.json(
          { ok: false, error: "Admin lookup failed" },
          { status: 500 }
        );
      }

      if (!data.users.length) break;

      for (const u of data.users) {
        if (eqCI(u.email, email)) {
          foundUser = u;
          break;
        }
      }

      if (foundUser) break;
      if (data.users.length < perPage) break;
      page += 1;
    }

    if (!foundUser) {
      return NextResponse.json({
        ok: true,
        exists: false,
        emailVerified: false,
      });
    }

    const meta = (foundUser.user_metadata ||
      foundUser.raw_user_meta_data ||
      {}) as Record<string, any>;

    const emailVerified = !!meta.email_verified;

    return NextResponse.json({
      ok: true,
      exists: true,
      emailVerified,
    });
  } catch (e: any) {
    console.error("[CHECK_CONFIRMED_UNEXPECTED_ERROR]", {
      message: e?.message,
      name: e?.name,
      stack: e?.stack,
      raw: e,
    });

    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
