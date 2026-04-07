import crypto from "crypto";

const NS_WRITES_URL =
  process.env.NS_WRITES_URL || "https://netsuite-writes.onrender.com";
const NS_WRITES_CLIENT_BEARER = process.env.NS_WRITES_ADMIN_BEARER;

export class EnqueueRecordPaymentError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type EnqueueRecordPaymentInput = {
  invoiceInternalId: number;
  amount: number;
  undepFunds?: boolean;
  accountId?: number;
  paymentMethodId?: number;
  paymentOptionId?: number;
  trandate?: string;
  memo?: string;
  externalId?: string;
  exchangeRate?: number;
  extraFields?: Record<string, unknown>;
  idempotencyKey?: string;
  callbackUrl?: string;
  callbackMethod?: string;
  callbackHeaders?: Record<string, string>;
  callbackSecret?: string;
};

export async function enqueueRecordPayment(input: EnqueueRecordPaymentInput) {
  const invoiceInternalId = Number(input.invoiceInternalId);
  const amount = Number(input.amount);

  if (!Number.isFinite(invoiceInternalId) || invoiceInternalId <= 0) {
    throw new EnqueueRecordPaymentError(
      "Missing or invalid invoiceInternalId",
      400,
    );
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new EnqueueRecordPaymentError("Amount must be > 0", 400);
  }

  const idempotencyKey =
    input.idempotencyKey ||
    `rp:${invoiceInternalId}:${amount}:${new Date()
      .toISOString()
      .slice(0, 10)}:${crypto.randomUUID()}`;

  const payload = {
    invoiceInternalId,
    amount,
    undepFunds: input.undepFunds ?? true,
    accountId: input.accountId ?? undefined,
    paymentMethodId: input.paymentMethodId ?? undefined,
    paymentOptionId: input.paymentOptionId ?? undefined,
    trandate: input.trandate ?? undefined,
    memo: input.memo ?? undefined,
    externalId: input.externalId ?? undefined,
    exchangeRate: input.exchangeRate ?? undefined,
    extraFields: input.extraFields ?? undefined,
    callbackUrl: input.callbackUrl ?? undefined,
    callbackMethod: input.callbackMethod ?? undefined,
    callbackHeaders: input.callbackHeaders ?? undefined,
    callbackSecret: input.callbackSecret ?? undefined,
  };

  const res = await fetch(`${NS_WRITES_URL}/api/netsuite/record-payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${NS_WRITES_CLIENT_BEARER}`,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok || json.error) {
    const message =
      String(json.message || json.error || `HTTP ${res.status}: ${text}`);
    throw new EnqueueRecordPaymentError(message, 502);
  }

  return {
    ok: true,
    queued: true,
    jobId: json.jobId != null ? String(json.jobId) : null,
    idempotencyKey,
    raw: json,
  };
}
