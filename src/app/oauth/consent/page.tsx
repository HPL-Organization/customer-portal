import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: { authorization_id?: string };
}) {
  const authorizationId = searchParams.authorization_id;

  if (!authorizationId) {
    return <div>Missing authorization_id</div>;
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(
      authorizationId
    )}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const { data: authDetails, error } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

  if (error || !authDetails) {
    return (
      <div>Error: {error?.message || "Invalid authorization request"}</div>
    );
  }

  const clientName = authDetails.client?.name || "Unknown app";
  const scopes = String(authDetails.scope || "")
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <h1>Authorize {clientName}</h1>
      <p>This application wants to access your account.</p>

      {scopes.length > 0 && (
        <>
          <h3>Requested permissions</h3>
          <ul>
            {scopes.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      )}

      <form action="/api/oauth/decision" method="POST">
        <input type="hidden" name="authorization_id" value={authorizationId} />
        <button type="submit" name="decision" value="approve">
          Approve
        </button>{" "}
        <button type="submit" name="decision" value="deny">
          Deny
        </button>
      </form>
    </main>
  );
}
