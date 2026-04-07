import {
  enqueueRecordPayment,
  type EnqueueRecordPaymentInput,
} from "@/lib/netsuite/enqueueRecordPayment";

const CALLBACK_BASE_URL = "https://portal.hplapidary.com";

const CALLBACK_SECRET =
  process.env.NSWRITES_WEBHOOK_SECRET ||
  process.env.PORTAL_CALLBACK_SECRET ||
  "";

export type SubmitAutoPayRecordPaymentInput = {
  invoiceInternalId: number;
  amount: number;
  paymentOptionId: number;
  groupId: string;
  undepFunds?: boolean;
  accountId?: number;
  paymentMethodId?: number;
  trandate?: string;
  memo?: string;
  exchangeRate?: number;
  extraFields?: Record<string, unknown>;
};

export async function submitAutoPayRecordPayment(
  input: SubmitAutoPayRecordPaymentInput,
) {
  const callbackUrl = `${CALLBACK_BASE_URL}/api/callbacks/record-payment-autopay-callback`;

  const payload: EnqueueRecordPaymentInput = {
    invoiceInternalId: input.invoiceInternalId,
    amount: input.amount,
    undepFunds: input.undepFunds ?? true,
    accountId: input.accountId,
    paymentMethodId: input.paymentMethodId,
    paymentOptionId: input.paymentOptionId,
    trandate: input.trandate,
    memo: input.memo || "Autopay stock change charge",
    externalId: input.groupId,
    exchangeRate: input.exchangeRate,
    extraFields: input.extraFields,
    idempotencyKey: input.groupId,
    callbackUrl,
    callbackMethod: "POST",
    callbackHeaders: { "x-source": "customer-portal-autopay" },
    callbackSecret: CALLBACK_SECRET || undefined,
  };

  return enqueueRecordPayment(payload);
}
