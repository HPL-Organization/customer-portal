import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await getServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin = getOrigin(req);
  const url = new URL("/api/netsuite/get-id-via-email", origin);
  url.searchParams.set("email", user.email.toLowerCase());

  let nsId: number | null = null;

  try {
    const r = await fetch(url.toString(), { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      const n = Number(j?.id);
      nsId = Number.isFinite(n) ? n : null;
    } else if (r.status !== 404) {
      const text = await r.text();
      return NextResponse.json(
        { error: "NetSuite lookup failed", details: text },
        { status: 502 }
      );
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: "Lookup request failed", details: String(e?.message ?? e) },
      { status: 502 }
    );
  }

  if (!nsId) {
    return NextResponse.json({ nsId: null }, { status: 200 });
  }

  const { error: upsertErr } = await supabase.from("profiles").upsert(
    {
      user_id: user.id,
      email: user.email,
      role: "customer",
      netsuite_customer_id: nsId,
    },
    { onConflict: "user_id" }
  );

  if (upsertErr) {
    return NextResponse.json({ error: "Upsert failed" }, { status: 500 });
  }

  return NextResponse.json({ nsId: String(nsId) });
}

function getOrigin(req: Request) {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) throw new Error("Missing host header");
  return `${proto}://${host}`;
}
