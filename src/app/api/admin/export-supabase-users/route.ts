import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_SYNC_SECRET = (process.env.ADMIN_SYNC_SECRET || "").trim();
const ADMIN_SECRET_HEADER = "x-admin-secret";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type ExportedUser = {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  confirmed_at: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  email_verified: boolean | null;
  provider: string | null;
  providers: string[];
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

export async function GET(req: NextRequest) {
  const secret = (req.headers.get(ADMIN_SECRET_HEADER) || "").trim();
  if (!ADMIN_SYNC_SECRET || secret !== ADMIN_SYNC_SECRET) {
    return unauthorized();
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const perPage = 1000;
  let page = 1;
  const exportedUsers: ExportedUser[] = [];

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to list users", page },
        { status: 500 }
      );
    }

    const users = data?.users ?? [];
    if (users.length === 0) break;

    for (const user of users) {
      const rawUserMeta = (user.user_metadata ?? {}) as Record<
        string,
        unknown
      >;
      const rawAppMeta = (user.app_metadata ?? {}) as Record<string, unknown>;

      exportedUsers.push({
        id: user.id,
        email: user.email ?? null,
        created_at: user.created_at ?? null,
        last_sign_in_at: user.last_sign_in_at ?? null,
        confirmed_at: user.confirmed_at ?? null,
        phone: user.phone ?? null,
        first_name:
          typeof rawUserMeta.first_name === "string"
            ? rawUserMeta.first_name
            : null,
        last_name:
          typeof rawUserMeta.last_name === "string"
            ? rawUserMeta.last_name
            : null,
        middle_name:
          typeof rawUserMeta.middle_name === "string"
            ? rawUserMeta.middle_name
            : null,
        email_verified:
          typeof rawUserMeta.email_verified === "boolean"
            ? rawUserMeta.email_verified
            : null,
        provider:
          typeof rawAppMeta.provider === "string" ? rawAppMeta.provider : null,
        providers: Array.isArray(rawAppMeta.providers)
          ? rawAppMeta.providers.filter(
              (value): value is string => typeof value === "string"
            )
          : [],
      });
    }

    if (users.length < perPage) break;
    page += 1;
  }

  const outDir = path.resolve(process.cwd(), "exports");
  await fs.mkdir(outDir, { recursive: true });

  const fileName = `supabase_users_${nowTag()}.json`;
  const filePath = path.join(outDir, fileName);
  const payload = {
    count: exportedUsers.length,
    users: exportedUsers,
  };

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");

  return NextResponse.json({
    ok: true,
    count: exportedUsers.length,
    fileName,
    filePath,
  });
}
