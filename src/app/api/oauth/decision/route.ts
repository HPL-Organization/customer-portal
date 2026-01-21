import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function copyCookies(from: NextResponse, to: NextResponse) {
  for (const c of from.cookies.getAll()) to.cookies.set(c);
  return to;
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const decision = String(formData.get("decision") || "");
  const authorizationId = String(formData.get("authorization_id") || "");

  if (!authorizationId) {
    return NextResponse.json(
      { error: "Missing authorization_id" },
      { status: 400 }
    );
  }

  const cookieStore = await cookies();
  const baseRes = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            baseRes.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  if (decision === "approve") {
    const { data, error } = await supabase.auth.oauth.approveAuthorization(
      authorizationId
    );
    if (error)
      return NextResponse.json({ error: error.message }, { status: 400 });

    const redirectRes = NextResponse.redirect(data.redirect_url);
    return copyCookies(baseRes, redirectRes);
  }

  const { data, error } = await supabase.auth.oauth.denyAuthorization(
    authorizationId
  );
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });

  const redirectRes = NextResponse.redirect(data.redirect_url);

  return copyCookies(baseRes, redirectRes);
}
