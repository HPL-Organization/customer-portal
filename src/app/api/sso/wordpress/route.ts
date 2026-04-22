// src/app/api/sso/wordpress/route.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

const SHARED_SECRET = process.env.WP_SSO_SECRET!;
const DEFAULT_WP_SSO_CALLBACK =
  "https://hpl1dev.wpenginepowered.com/wp-admin/admin-ajax.php?action=hpl_sso_callback";
const WP_SSO_CALLBACK =
  process.env.WP_SSO_CALLBACK?.trim() || DEFAULT_WP_SSO_CALLBACK;
const PORTAL_BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://portal.hplapidary.com";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Using the public portal URL here so SSO testing does not depend on the incoming host.(I am aware its not consistent in other routes)
  if (!user) {
    const selfUrl = `${PORTAL_BASE_URL}/api/sso/wordpress`;
    const returnTo = encodeURIComponent(selfUrl);
    return NextResponse.redirect(`${PORTAL_BASE_URL}/login?next=${returnTo}`);
  }

  if (!user.email) {
    return NextResponse.json({ error: "Missing user email" }, { status: 400 });
  }

  // Build a signed token: email + expiry, signed with shared secret
  const payload = {
    email: user.email,
    name: user.user_metadata?.full_name || user.email,
    exp: Math.floor(Date.now() / 1000) + 120, //2 mins
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SHARED_SECRET)
    .update(payloadStr)
    .digest("hex");

  const token = `${payloadStr}.${sig}`;

  return NextResponse.redirect(`${WP_SSO_CALLBACK}&token=${token}`);
}
