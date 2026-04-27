import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnqueueRecordPayment } = vi.hoisted(() => ({
  mockEnqueueRecordPayment: vi.fn(),
}));

vi.mock("@/lib/netsuite/enqueueRecordPayment", () => ({
  enqueueRecordPayment: mockEnqueueRecordPayment,
}));

describe("submitAutoPayRecordPayment", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.PORTAL_CALLBACK_BASE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.PORTAL_BASE_URL;
    delete process.env.NSWRITES_WEBHOOK_SECRET;
    delete process.env.PORTAL_CALLBACK_SECRET;
    mockEnqueueRecordPayment.mockResolvedValue({
      ok: true,
      queued: true,
      jobId: "job-123",
      idempotencyKey: "group-1",
      raw: {},
    });
  });

  it("payload build: uses groupId as externalId and idempotency key with default callback settings", async () => {
    const { submitAutoPayRecordPayment } = await import("../submit-autopay-record-payment");

    await submitAutoPayRecordPayment({
      invoiceInternalId: 9001,
      amount: 125.5,
      paymentOptionId: 333,
      groupId: "group-1",
    });

    expect(mockEnqueueRecordPayment).toHaveBeenCalledWith({
      invoiceInternalId: 9001,
      amount: 125.5,
      undepFunds: true,
      accountId: undefined,
      paymentMethodId: undefined,
      paymentOptionId: 333,
      trandate: undefined,
      memo: "Autopay stock change charge",
      externalId: "group-1",
      exchangeRate: undefined,
      extraFields: undefined,
      idempotencyKey: "group-1",
      callbackUrl:
        "https://portal.hplapidary.com/api/callbacks/record-payment-autopay-callback",
      callbackMethod: "POST",
      callbackHeaders: { "x-source": "customer-portal-autopay" },
      callbackSecret: undefined,
    });
  });

  it("payload build: passes through optional fields and callback secret", async () => {
    process.env.NSWRITES_WEBHOOK_SECRET = "secret-123";

    const { submitAutoPayRecordPayment } = await import("../submit-autopay-record-payment");

    await submitAutoPayRecordPayment({
      invoiceInternalId: 9100,
      amount: 50,
      paymentOptionId: 444,
      groupId: "group-99",
      undepFunds: false,
      accountId: 12,
      paymentMethodId: 77,
      trandate: "2026-03-26",
      memo: "Custom autopay memo",
      exchangeRate: 1.25,
      extraFields: { department: "autopay" },
    });

    expect(mockEnqueueRecordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceInternalId: 9100,
        amount: 50,
        undepFunds: false,
        accountId: 12,
        paymentMethodId: 77,
        paymentOptionId: 444,
        trandate: "2026-03-26",
        memo: "Custom autopay memo",
        externalId: "group-99",
        exchangeRate: 1.25,
        extraFields: { department: "autopay" },
        idempotencyKey: "group-99",
        callbackUrl:
          "https://portal.hplapidary.com/api/callbacks/record-payment-autopay-callback",
        callbackSecret: "secret-123",
      }),
    );
  });
});
