import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

type CallbackPayload = {
  job_id: string;
  type: "record_payment";
  status: "done" | "failed";
  result?: { paymentId?: number | string; mode?: string };
  error?: unknown;
  meta?: {
    invoiceInternalId?: number | string;
    amount?: number;
    undepFunds?: boolean;
    accountId?: number;
    paymentMethodId?: number;
    paymentOptionId?: number;
  };
};

function verifySignature(
  body: string,
  header: string | null,
  secret: string | undefined,
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
  let payload: CallbackPayload | null = null;

  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const secret =
    process.env.NSWRITES_WEBHOOK_SECRET ||
    process.env.PORTAL_CALLBACK_SECRET ||
    "";
  const header = req.headers.get("x-job-signature");
  const skip = process.env.CALLBACK_SKIP_VERIFY === "1";
  if (!skip && !verifySignature(raw, header, secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  if (!payload || payload.type !== "record_payment") {
    return NextResponse.json(
      { error: "unsupported callback type" },
      { status: 400 },
    );
  }

  const invoiceId = Number(payload.meta?.invoiceInternalId);
  if (!invoiceId || !Number.isFinite(invoiceId)) {
    return NextResponse.json(
      { error: "missing invoiceInternalId" },
      { status: 400 },
    );
  }

  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );

  const autopayUpdate =
    payload.status === "done"
      ? {
          status: "paid",
          callback_received_at: new Date().toISOString(),
          last_callback_status: payload.status,
          payment_id:
            payload.result?.paymentId != null
              ? String(payload.result.paymentId)
              : null,
          last_error: null,
          callback_payload: payload,
        }
      : {
          status: "failed",
          callback_received_at: new Date().toISOString(),
          last_callback_status: payload.status,
          last_error:
            typeof payload.error === "string"
              ? payload.error
              : JSON.stringify(payload.error ?? null),
          callback_payload: payload,
        };

  const { data: updatedRows, error: autopayError } = await supa
    .from("autopayment_queue_stock_change")
    .update(autopayUpdate)
    .eq("netsuite_job_id", payload.job_id)
    .select("id");

  if (autopayError) {
    return NextResponse.json(
      { ok: false, error: autopayError.message, job: payload.job_id },
      { status: 500 },
    );
  }

  if (!updatedRows?.length) {
    return NextResponse.json(
      {
        ok: false,
        error: "No autopay queue rows matched callback job_id",
        job: payload.job_id,
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    invoiceId,
    job: payload.job_id,
    status: payload.status,
    updatedRows: updatedRows.length,
  });
}
