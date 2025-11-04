import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

type CallbackPayload = {
  job_id: string;
  type: "record_payment";
  status: "done" | "failed";
  result?: { paymentId?: number | string; mode?: string };
  error?: any;
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
      { status: 400 }
    );
  }

  const invoiceId = Number(payload.meta?.invoiceInternalId);
  if (!invoiceId || !Number.isFinite(invoiceId)) {
    return NextResponse.json(
      { error: "missing invoiceInternalId" },
      { status: 400 }
    );
  }

  const supa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );

  const { error } = await supa
    .from("invoices")
    .update({ payment_processing: false })
    .eq("invoice_id", invoiceId);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    invoiceId,
    job: payload.job_id,
    status: payload.status,
  });
}
