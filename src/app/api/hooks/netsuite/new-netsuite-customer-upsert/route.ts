import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = req.headers.get("x-webhook-secret");
  if (secret !== process.env.NETSUITE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let email = "";
  let netsuite_customer_id: number | null = null;
  try {
    const body = await req.json();
    email = String(body?.email ?? "")
      .trim()
      .toLowerCase();
    const n = Number(body?.netsuite_customer_id);
    netsuite_customer_id = Number.isFinite(n) ? n : null;
  } catch {
    /* ignore */
  }
  if (!email || !netsuite_customer_id) {
    return NextResponse.json(
      { error: "email and netsuite_customer_id required" },
      { status: 400 }
    );
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  (async () => {
    try {
      await admin
        .from("profiles")
        .upsert(
          { user_id: null, email, role: "customer", netsuite_customer_id },
          { onConflict: "email" }
        );
    } catch (_) {
      /* skip */
    }
  })();

  return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}
