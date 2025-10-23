// src/app/api/auth/check-email/route.ts
import { NextRequest, NextResponse } from "next/server";

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

    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const emailClean = String(email).trim().toLowerCase();

    // GoTrue Admin API: GET /auth/v1/admin/users?email=...
    const res = await fetch(
      `${base.replace(
        /\/+$/,
        ""
      )}/auth/v1/admin/users?email=${encodeURIComponent(emailClean)}`,
      {
        method: "GET",
        headers: {
          apikey: service,
          Authorization: `Bearer ${service}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: `Admin lookup failed: ${res.status} ${txt}` },
        { status: 500 }
      );
    }

    const users = (await res.json()) as any[];
    const user = Array.isArray(users) ? users[0] : null;

    if (user) {
      return NextResponse.json({
        ok: true,
        exists: true,
        confirmed: Boolean(user?.email_confirmed_at),
        masked: maskEmail(emailClean),
      });
    }

    return NextResponse.json({ ok: true, exists: false });
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
