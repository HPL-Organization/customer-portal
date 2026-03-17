import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = String(body?.email ?? "").trim();
    const password = String(body?.password ?? "");

    if (!email || !password) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing email or password",
          userId: null,
        },
        { status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    return NextResponse.json(
      {
        ok: !error,
        error: error?.message ?? null,
        userId: data.user?.id ?? null,
      },
      { status: error ? 401 : 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";

    return NextResponse.json(
      {
        ok: false,
        error: message,
        userId: null,
      },
      { status: 500 }
    );
  }
}
