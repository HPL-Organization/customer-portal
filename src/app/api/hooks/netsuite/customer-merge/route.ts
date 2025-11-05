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

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-netsuite-webhook-secret");
  if (!secret || secret !== process.env.NETSUITE_MERGE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: MergePayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (payload.event !== "netsuite.entity.merge") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const masterId = Number(payload.masterId);
  const email = payload.masterEmail?.trim();
  if (!Number.isFinite(masterId) || !email) {
    return NextResponse.json(
      { error: "missing masterId or masterEmail" },
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
      { error: "update failed", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    updated: data?.length ?? 0,
    masterId,
    email,
  });
}
