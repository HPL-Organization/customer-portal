import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAdminFromCookies() {
  const cookieStore = await cookies();
  const impCookie = cookieStore.get("imp")?.value;
  const nsIdCookie = cookieStore.get("nsId")?.value;
  return impCookie === "1" && !!nsIdCookie;
}

function getServiceSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function csvEscape(value: unknown) {
  const s = value == null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function nowTag() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "_" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

export async function GET() {
  if (!(await isAdminFromCookies())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceSupabase();

  const perPage = 1000;
  let page = 1;

  const rows: Array<{
    email: string;
    first_name: string;
    middle_name: string;
    last_name: string;
  }> = [];

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to list users" },
        { status: 500 }
      );
    }

    const users = data?.users ?? [];
    if (users.length === 0) break;

    for (const u of users) {
      const email = (u.email ?? "").trim();
      if (!email) continue;

      const md = (u.user_metadata ?? {}) as Record<string, unknown>;

      rows.push({
        email,
        first_name: typeof md.first_name === "string" ? md.first_name : "",
        middle_name: typeof md.middle_name === "string" ? md.middle_name : "",
        last_name: typeof md.last_name === "string" ? md.last_name : "",
      });
    }

    if (users.length < perPage) break;
    page += 1;
  }

  rows.sort((a, b) => a.email.localeCompare(b.email));

  const header = ["email", "first_name", "middle_name", "last_name"];
  const lines = [
    header.map(csvEscape).join(","),
    ...rows.map((r) =>
      [r.email, r.first_name, r.middle_name, r.last_name]
        .map(csvEscape)
        .join(",")
    ),
  ];

  const csv = lines.join("\r\n");
  const filename = `portal_users_${nowTag()}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
