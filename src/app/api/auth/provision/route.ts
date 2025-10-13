// src/app/api/auth/provision/route.ts
import { NextResponse, NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import { getValidToken } from "@/lib/netsuite/token";

export const dynamic = "force-dynamic";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const NS_BASE = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

async function createNetSuiteCustomerSimple(
  name: string,
  email: string,
  middleName?: string
) {
  const [firstName, ...rest] = name.trim().split(" ");
  const lastName = rest.join(" ") || firstName;
  const token = await getValidToken();
  const payload: Record<string, any> = {
    entityId: email,
    subsidiary: { id: "2" },
    companyName: name,
    firstName,
    lastName,
    email,
  };
  if (middleName) payload.middleName = middleName;

  const res = await axios.post(`${NS_BASE}/record/v1/customer`, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });

  let id: string | null = null;
  if ((res.data as any)?.id) id = (res.data as any).id;
  else if (res.headers.location) {
    const m = String(res.headers.location).match(/customer\/(\d+)/);
    if (m) id = m[1];
  }

  if (!id || res.status >= 300) {
    const details =
      typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    throw new Error(`netsuite-create-failed (${res.status}): ${details}`);
  }
  return Number(id);
}

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
  const firstName = (body?.firstName ?? meta.first_name ?? "")
    .toString()
    .trim();
  const middleName = (body?.middleName ?? meta.middle_name ?? "")
    .toString()
    .trim();
  const lastName = (body?.lastName ?? meta.last_name ?? "").toString().trim();

  const emailLC = user.email.toLowerCase();

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

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
    .select("profile_id, netsuite_customer_id")
    .eq("email", emailLC)
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (preloaded?.netsuite_customer_id) {
    const { error: claimErr } = await admin
      .from("profiles")
      .update({ user_id: user.id, email: emailLC, role: "customer" })
      .eq("profile_id", preloaded.profile_id)
      .is("user_id", null);
    if (!claimErr) {
      return NextResponse.json({
        nsId: String(preloaded.netsuite_customer_id),
        mode: "claimed",
      });
    }
  }

  try {
    const fullName = [firstName, lastName].filter(Boolean).join(" ") || emailLC;
    const nsIdNum = await createNetSuiteCustomerSimple(
      fullName,
      emailLC,
      middleName || undefined
    );

    const { error: upsertErr } = await admin
      .from("profiles")
      .upsert(
        {
          user_id: user.id,
          email: emailLC,
          role: "customer",
          netsuite_customer_id: nsIdNum,
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
    return NextResponse.json({ nsId: String(nsIdNum), mode: "created" });
  } catch (e: any) {
    return NextResponse.json(
      {
        nsId: null,
        error: "netsuite-create-failed",
        step: "netsuite",
        details: String(e?.message || e),
      },
      { status: 200 }
    );
  }
}
