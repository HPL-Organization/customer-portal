import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type MergePayload = {
  event: string;
  masterId: number;
  masterEmail?: string | null;
};

function getSupabaseSR() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Missing Supabase URL or service role key");
  return createClient(url, key);
}

function getEnvSecret(): string {
  const s1 = process.env.NETSUITE_MERGE_WEBHOOK_SECRET?.trim();
  const s2 = process.env.MERGE_WEBHOOK_SECRET?.trim();
  return (s1 || s2 || "").trim();
}

function mask(s: string | null | undefined) {
  const v = (s || "").toString();
  if (!v) return { len: 0, head: "", tail: "" };
  return { len: v.length, head: v.slice(0, 6), tail: v.slice(-6) };
}

export async function POST(req: NextRequest) {
  const headerSecretRaw = req.headers.get("x-netsuite-webhook-secret");
  const headerSecret = headerSecretRaw?.trim() || "";
  const envSecret = getEnvSecret();
  const now = new Date().toISOString();

  const debugBase = {
    now,
    headerMeta: mask(headerSecret),
    envMeta: mask(envSecret),
    hasHeader: !!headerSecret,
    hasEnv: !!envSecret,
  };

  if (!headerSecret || !envSecret || headerSecret !== envSecret) {
    return NextResponse.json(
      { error: "unauthorized", debug: debugBase },
      { status: 401 }
    );
  }

  let payload: MergePayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid json", debug: debugBase },
      { status: 400 }
    );
  }

  if (payload.event !== "netsuite.entity.merge") {
    return NextResponse.json({ ok: true, ignored: true, debug: debugBase });
  }

  const masterId = Number(payload.masterId);
  const email = payload.masterEmail?.trim();
  if (!Number.isFinite(masterId) || !email) {
    return NextResponse.json(
      {
        error: "missing masterId or masterEmail",
        debug: { ...debugBase, masterId, email },
      },
      { status: 400 }
    );
  }

  const supabase = getSupabaseSR();

  const { data, error } = await supabase
    .from("profiles")
    .update({ netsuite_customer_id: masterId })
    .ilike("email", email)
    .select("profile_id, email, netsuite_customer_id");

  if (error) {
    return NextResponse.json(
      {
        error: "update failed",
        details: error.message,
        debug: { ...debugBase, masterId, email },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    updated: data?.length ?? 0,
    masterId,
    email,
    debug: debugBase,
  });
}
