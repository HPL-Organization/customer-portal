import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

type CallbackPayload = {
  job_id: string;
  type: "save_payment_method";
  status: "done" | "failed";
  result?: any;
  error?: any;
  meta?: {
    clientRef?: string;
    customerInternalId?: number | string;
    accountType?: string | null;
    accountNumberLastFour?: string | null;
    tokenExpirationDate?: string | null;
  } | null;
};

function verifySignature(
  body: string,
  header: string | null,
  secret: string | undefined
) {
  if (!secret) return true;
  if (!header) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  const secret =
    process.env.NSWRITES_WEBHOOK_SECRET ||
    process.env.PORTAL_CALLBACK_SECRET ||
    "";
  const header = req.headers.get("x-job-signature");
  const skip = process.env.CALLBACK_SKIP_VERIFY === "1";
  if (!skip && !verifySignature(raw, header, secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  // Parse JSON
  let payload: CallbackPayload | null = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!payload || payload.type !== "save_payment_method") {
    return NextResponse.json(
      { error: "unsupported callback type" },
      { status: 400 }
    );
  }

  const piId = payload.meta?.clientRef;
  if (!piId) {
    return NextResponse.json({ error: "missing clientRef" }, { status: 400 });
  }

  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );

  const nowIso = new Date().toISOString();

  if (payload.status === "done") {
    const instrumentId =
      payload.result?.paymentCardTokenId ??
      payload.result?.id ??
      payload.result?.instrumentId ??
      payload.result?.tokenId ??
      payload.result?.ns?.paymentCardTokenId ??
      null;

    const { error } = await supa
      .from("payment_instruments")
      .update({
        instrument_id: instrumentId ? String(instrumentId) : undefined,
        netsuite_writes_status: "success",
        synced_at: nowIso,
      })
      .eq("pi_id", piId);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      pi_id: piId,
      job: payload.job_id,
      status: payload.status,
      instrumentId,
    });
  }

  if (payload.status === "failed") {
    const { error } = await supa
      .from("payment_instruments")
      .update({
        netsuite_writes_status: "failed",
        synced_at: nowIso,
      })
      .eq("pi_id", piId);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      pi_id: piId,
      job: payload.job_id,
      status: payload.status,
    });
  }

  return NextResponse.json({ error: "unknown status" }, { status: 400 });
}
