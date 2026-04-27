import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeQueueRow } from "@/test/autopay/factories";
import { createUpdateSupabaseMock } from "@/test/autopay/mock-supabase";
import type { PaymentInstrumentRow } from "../types";

const {
  mockFetchQueueRows,
  mockFetchCustomerInfoByIds,
  mockFetchPaymentInstrumentsByCustomerIds,
  mockSetInvoicePaymentProcessing,
  mockDescribeQueueRow,
  mockSubmitAutoPayRecordPayment,
} = vi.hoisted(() => ({
  mockFetchQueueRows: vi.fn(),
  mockFetchCustomerInfoByIds: vi.fn(),
  mockFetchPaymentInstrumentsByCustomerIds: vi.fn(),
  mockSetInvoicePaymentProcessing: vi.fn(),
  mockDescribeQueueRow: vi.fn(),
  mockSubmitAutoPayRecordPayment: vi.fn(),
}));

vi.mock("../utils", async () => {
  const actual = await vi.importActual<typeof import("../utils")>("../utils");
  return {
    ...actual,
    fetchQueueRows: mockFetchQueueRows,
    fetchCustomerInfoByIds: mockFetchCustomerInfoByIds,
    fetchPaymentInstrumentsByCustomerIds: mockFetchPaymentInstrumentsByCustomerIds,
    setInvoicePaymentProcessing: mockSetInvoicePaymentProcessing,
    describeQueueRow: mockDescribeQueueRow,
  };
});

vi.mock("../submit-autopay-record-payment", () => ({
  submitAutoPayRecordPayment: mockSubmitAutoPayRecordPayment,
}));

function makeInstrument(
  overrides: Partial<PaymentInstrumentRow> = {},
): PaymentInstrumentRow {
  return {
    customer_id: 2001,
    instrument_id: "501",
    payment_method: "Card Token",
    brand: "Visa",
    last4: "1111",
    payer_email: "customer@example.com",
    is_default: false,
    netsuite_writes_status: "success",
    ns_deleted_at: null,
    ...overrides,
  };
}

describe("submitGroupPayments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    mockDescribeQueueRow.mockImplementation((row) => row);
    mockSetInvoicePaymentProcessing.mockResolvedValue(undefined);
    mockFetchCustomerInfoByIds.mockResolvedValue(new Map());
    mockSubmitAutoPayRecordPayment.mockResolvedValue({
      jobId: "job-123",
      idempotencyKey: "group-1",
    });
  });

  it("charges using the preferred autopay method", async () => {
    const rowA = makeQueueRow({
      id: 1,
      group_id: "group-1",
      invoice_id: 9001,
      customer_id: 2001,
      status: "notified",
      email_sent_at: "2026-03-26T10:00:00.000Z",
      charge_after: "2026-03-26T11:00:00.000Z",
      charge_amount: 100,
    });
    const rowB = makeQueueRow({
      id: 2,
      so_id: 102,
      ns_line_id: 2,
      group_id: "group-1",
      invoice_id: 9001,
      customer_id: 2001,
      status: "notified",
      email_sent_at: "2026-03-26T10:00:00.000Z",
      charge_after: "2026-03-26T11:00:00.000Z",
      charge_amount: 55.25,
    });
    const { client, updates } = createUpdateSupabaseMock();

    mockFetchQueueRows.mockResolvedValue([rowA, rowB]);
    mockFetchCustomerInfoByIds.mockResolvedValue(
      new Map([[2001, { customer_id: 2001, email: null, first_name: null, company_name: null, express_pay: "777" }]]),
    );
    mockFetchPaymentInstrumentsByCustomerIds.mockResolvedValue(
      new Map([
        [
          2001,
          [
            makeInstrument({
              instrument_id: "501",
              is_default: true,
            }),
            makeInstrument({
              instrument_id: "777",
            }),
          ],
        ],
      ]),
    );

    const { submitGroupPayments } = await import("../submit-group-payment");

    const result = await submitGroupPayments({
      supabase: client as never,
    });

    expect(mockSubmitAutoPayRecordPayment).toHaveBeenCalledWith({
      invoiceInternalId: 9001,
      amount: 155.25,
      paymentOptionId: 777,
      groupId: "group-1",
    });
    expect(mockSetInvoicePaymentProcessing).toHaveBeenCalledWith(
      client,
      [9001],
      true,
    );
    expect(updates).toEqual([
      {
        table: "autopayment_queue_stock_change",
        values: {
          status: "submitted",
          charge_submitted_at: "2026-03-26T12:00:00.000Z",
          netsuite_job_id: "job-123",
          last_error: null,
          notes: null,
        },
        filters: [{ column: "group_id", value: "group-1" }],
      },
    ]);
    expect(result.failures).toEqual([]);
    expect(result.updatedRows).toBe(2);
  });

  it("does not fall back to is_default when no preferred method is set", async () => {
    const row = makeQueueRow({
      id: 10,
      group_id: "group-10",
      invoice_id: 9010,
      customer_id: 2010,
      status: "notified",
      email_sent_at: "2026-03-26T10:00:00.000Z",
      charge_after: "2026-03-26T11:00:00.000Z",
      charge_amount: 42,
    });
    const { client, updates } = createUpdateSupabaseMock();

    mockFetchQueueRows.mockResolvedValue([row]);
    mockFetchCustomerInfoByIds.mockResolvedValue(
      new Map([[2010, { customer_id: 2010, email: null, first_name: null, company_name: null, express_pay: null }]]),
    );
    mockFetchPaymentInstrumentsByCustomerIds.mockResolvedValue(
      new Map([
        [
          2010,
          [
            makeInstrument({
              customer_id: 2010,
              instrument_id: "888",
              is_default: true,
            }),
          ],
        ],
      ]),
    );

    const { submitGroupPayments } = await import("../submit-group-payment");

    const result = await submitGroupPayments({
      supabase: client as never,
    });

    expect(mockSubmitAutoPayRecordPayment).not.toHaveBeenCalled();
    expect(mockSetInvoicePaymentProcessing).not.toHaveBeenCalled();
    expect(result.failures).toEqual([
      { groupId: "group-10", reason: "missing_payment_instrument" },
    ]);
    expect(updates).toEqual([
      {
        table: "autopayment_queue_stock_change",
        values: {
          status: "needs_review",
          last_error: "missing_payment_instrument",
          notes: "No eligible saved payment instrument found for customer",
        },
        filters: [{ column: "group_id", value: "group-10" }],
      },
    ]);
  });

  it("ignores preferred methods that are processing or failed", async () => {
    const row = makeQueueRow({
      id: 20,
      group_id: "group-20",
      invoice_id: 9020,
      customer_id: 2020,
      status: "notified",
      email_sent_at: "2026-03-26T10:00:00.000Z",
      charge_after: "2026-03-26T11:00:00.000Z",
      charge_amount: 75,
    });
    const { client, updates } = createUpdateSupabaseMock();

    mockFetchQueueRows.mockResolvedValue([row]);
    mockFetchCustomerInfoByIds.mockResolvedValue(
      new Map([[2020, { customer_id: 2020, email: null, first_name: null, company_name: null, express_pay: "999" }]]),
    );
    mockFetchPaymentInstrumentsByCustomerIds.mockResolvedValue(
      new Map([
        [
          2020,
          [
            makeInstrument({
              customer_id: 2020,
              instrument_id: "999",
              netsuite_writes_status: "processing",
            }),
            makeInstrument({
              customer_id: 2020,
              instrument_id: "1000",
              is_default: true,
            }),
          ],
        ],
      ]),
    );

    const { submitGroupPayments } = await import("../submit-group-payment");

    const result = await submitGroupPayments({
      supabase: client as never,
    });

    expect(mockSubmitAutoPayRecordPayment).not.toHaveBeenCalled();
    expect(result.failures).toEqual([
      { groupId: "group-20", reason: "missing_payment_instrument" },
    ]);
    expect(updates).toEqual([
      {
        table: "autopayment_queue_stock_change",
        values: {
          status: "needs_review",
          last_error: "missing_payment_instrument",
          notes: "No eligible saved payment instrument found for customer",
        },
        filters: [{ column: "group_id", value: "group-20" }],
      },
    ]);
  });
});
