// src/app/api/auth/provision/route.ts
import { NextResponse, NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function clean(s: any) {
  return (s ?? "").toString().trim();
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const NSW_BASE_URL = process.env.NS_WRITES_URL || "http://localhost:3000"; //

const NSW_AUTH_SECRET = process.env.NS_WRITES_ADMIN_BEARER;

const PORTAL_BASE_URL = "https://portal.hplapidary.com"; //; //http://localhost:3001

export async function POST(req: NextRequest) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = null;
  try {
    body = await req.json();
  } catch {}

  const meta = (user.user_metadata as any) || {};
  const firstName = clean(body?.firstName) || clean(meta.first_name);
  const middleName = clean(body?.middleName) || clean(meta.middle_name);
  const lastName = clean(body?.lastName) || clean(meta.last_name);

  const emailLC = user.email.toLowerCase();

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: existing } = await admin
    .from("profiles")
    .select("netsuite_customer_id")
    .eq("user_id", user.id)
    .single();
  if (existing?.netsuite_customer_id) {
    return NextResponse.json({
      nsId: String(existing.netsuite_customer_id),
      mode: "existing",
    });
  }

  const { data: preloaded } = await admin
    .from("profiles")
    .select("profile_id, netsuite_customer_id, email")
    .ilike("email", emailLC)
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (preloaded?.netsuite_customer_id) {
    const { error: claimErr } = await admin
      .from("profiles")
      .update({ user_id: user.id, role: "customer" })
      .eq("profile_id", preloaded.profile_id)
      .is("user_id", null);
    if (!claimErr) {
      const metaUpdates: Record<string, string> = {};
      if (firstName && !clean(meta.first_name))
        metaUpdates.first_name = firstName;
      if (middleName && !clean(meta.middle_name))
        metaUpdates.middle_name = middleName;
      if (lastName && !clean(meta.last_name)) metaUpdates.last_name = lastName;
      if (Object.keys(metaUpdates).length) {
        await admin.auth.admin.updateUserById(user.id, {
          user_metadata: { ...meta, ...metaUpdates },
        });
      }
      return NextResponse.json({
        nsId: String(preloaded.netsuite_customer_id),
        mode: "claimed",
      });
    }
  }

  const fullName = [firstName, lastName].filter(Boolean).join(" ") || emailLC;

  const { error: upsertErr } = await admin.from("profiles").upsert(
    {
      user_id: user.id,
      email: emailLC,
      role: "customer",
      netsuite_customer_id: -1,
    },
    { onConflict: "email" }
  );

  if (upsertErr) {
    return NextResponse.json(
      {
        nsId: null,
        error: "profile-upsert-failed",
        step: "profiles",
        details: upsertErr.message,
      },
      { status: 200 }
    );
  }

  const metaUpdates: Record<string, string> = {};
  if (firstName && !clean(meta.first_name)) metaUpdates.first_name = firstName;
  if (middleName && !clean(meta.middle_name))
    metaUpdates.middle_name = middleName;
  if (lastName && !clean(meta.last_name)) metaUpdates.last_name = lastName;
  if (Object.keys(metaUpdates).length) {
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...meta, ...metaUpdates },
    });
  }

  const callbackUrl = `${PORTAL_BASE_URL}/api/callbacks/create-simple-customer-callback`;
  const idemKey = `cr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.log("Idem key", idemKey);

  try {
    await fetch(`${NSW_BASE_URL}/api/netsuite/create-simple-customer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NSW_AUTH_SECRET}`,
        "Idempotency-Key": idemKey,
      },
      body: JSON.stringify({
        name: fullName,
        email: emailLC,
        middleName: middleName || undefined,
        callbackUrl,
      }),
    });
  } catch (e) {
    console.log("Error in provisioning to NS writes", e);
  }

  return NextResponse.json(
    {
      nsId: null,
      mode: "queued",
    },
    { status: 200 }
  );
}
