import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendGroupNotifications } from "../send-group-notification";
import { makeQueueRow } from "@/test/autopay/factories";
import { createUpdateSupabaseMock } from "@/test/autopay/mock-supabase";
import type { CustomerInfoRow } from "../types";

const {
  mockFetchQueueRows,
  mockFetchCustomerInfoByIds,
  mockFetchInvoicesByIds,
  mockFetchSalesOrdersByIds,
  mockNowPlusDaysIso,
  mockSendAutopayPendingChargeNotification,
} = vi.hoisted(() => ({
  mockFetchQueueRows: vi.fn(),
  mockFetchCustomerInfoByIds: vi.fn(),
  mockFetchInvoicesByIds: vi.fn(),
  mockFetchSalesOrdersByIds: vi.fn(),
  mockNowPlusDaysIso: vi.fn(),
  mockSendAutopayPendingChargeNotification: vi.fn(),
}));

vi.mock("../utils", async () => {
  const actual = await vi.importActual<typeof import("../utils")>("../utils");
  return {
    ...actual,
    fetchQueueRows: mockFetchQueueRows,
    fetchCustomerInfoByIds: mockFetchCustomerInfoByIds,
    fetchInvoicesByIds: mockFetchInvoicesByIds,
    fetchSalesOrdersByIds: mockFetchSalesOrdersByIds,
    nowPlusDaysIso: mockNowPlusDaysIso,
  };
});

vi.mock("@/lib/email/templates/autopay-pending-charge", () => ({
  sendAutopayPendingChargeNotification: mockSendAutopayPendingChargeNotification,
}));

function makeCustomerInfo(
  overrides: Partial<CustomerInfoRow> = {},
): CustomerInfoRow {
  return {
    customer_id: 2001,
    email: "customer@example.com",
    first_name: "Raktim",
    company_name: null,
    express_pay: "777",
    ...overrides,
  };
}

describe("sendGroupNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    mockNowPlusDaysIso.mockReturnValue("2026-03-28T12:00:00.000Z");
    mockSendAutopayPendingChargeNotification.mockResolvedValue(undefined);
    mockFetchInvoicesByIds.mockResolvedValue(new Map());
    mockFetchSalesOrdersByIds.mockResolvedValue(new Map());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("notification success: uses customer_information.email and marks rows notified", async () => {
    const rowA = makeQueueRow({
      id: 1,
      group_id: "group-1",
      invoice_id: 9001,
      customer_id: 2001,
      charge_amount: 100,
    });
    const rowB = makeQueueRow({
      id: 2,
      so_id: 102,
      ns_line_id: 2,
      group_id: "group-1",
      invoice_id: 9001,
      customer_id: 2001,
      charge_amount: 55.25,
    });
    const { client, updates } = createUpdateSupabaseMock();

    mockFetchQueueRows.mockResolvedValue([rowA, rowB]);
    mockFetchCustomerInfoByIds.mockResolvedValue(
      new Map([[2001, makeCustomerInfo({ email: "customer@example.com" })]]),
    );
    mockFetchInvoicesByIds.mockResolvedValue(
      new Map([[9001, { invoice_id: 9001, tran_id: "INV-9001", customer_id: 2001, amount_remaining: 155.25, payment_processing: false, payment_processing_started_at: null }]]),
    );
    mockFetchSalesOrdersByIds.mockResolvedValue(
      new Map([[101, { so_id: 101, customer_id: 2001, tran_id: "SO-101" }], [102, { so_id: 102, customer_id: 2001, tran_id: "SO-102" }]]),
    );

    const result = await sendGroupNotifications({
      supabase: client as never,
    });

    expect(mockSendAutopayPendingChargeNotification).toHaveBeenCalledWith({
      to: "customer@example.com",
      firstName: "Raktim",
      invoiceTranId: "INV-9001",
      soTranId: "SO-101",
      invoiceId: 9001,
      amount: 155.25,
      chargeAfterIso: "2026-03-28T12:00:00.000Z",
    });
    expect(updates).toEqual([
      {
        table: "autopayment_queue_stock_change",
        values: {
          status: "notified",
          email_sent_at: "2026-03-26T12:00:00.000Z",
          charge_after: "2026-03-28T12:00:00.000Z",
          last_error: null,
          notes: null,
        },
        filters: [{ column: "group_id", value: "group-1" }],
      },
    ]);
    expect(result.failures).toEqual([]);
    expect(result.updatedRows).toBe(2);
  });

  it("review path: moves rows to needs_review when customer information is missing", async () => {
    const row = makeQueueRow({
      id: 10,
      group_id: "group-10",
      invoice_id: 9010,
      customer_id: 2010,
      charge_amount: 42,
    });
    const { client, updates } = createUpdateSupabaseMock();

    mockFetchQueueRows.mockResolvedValue([row]);
    mockFetchCustomerInfoByIds.mockResolvedValue(new Map());

    const result = await sendGroupNotifications({
      supabase: client as never,
    });

    expect(mockSendAutopayPendingChargeNotification).not.toHaveBeenCalled();
    expect(result.failures).toEqual([
      { groupId: "group-10", reason: "missing_customer_info" },
    ]);
    expect(updates).toEqual([
      {
        table: "autopayment_queue_stock_change",
        values: {
          status: "needs_review",
          last_error: "missing_customer_info",
          notes: "No customer_information row was found for autopay notification",
        },
        filters: [{ column: "group_id", value: "group-10" }],
      },
    ]);
  });

  it("review path: moves rows to needs_review when customer_information.email is missing", async () => {
    const row = makeQueueRow({
      id: 20,
      group_id: "group-20",
      invoice_id: 9020,
      customer_id: 2020,
    });
    const { client, updates } = createUpdateSupabaseMock();

    mockFetchQueueRows.mockResolvedValue([row]);
    mockFetchCustomerInfoByIds.mockResolvedValue(
      new Map([[2020, makeCustomerInfo({ customer_id: 2020, email: null, first_name: null, company_name: "HPL" })]]),
    );

    const result = await sendGroupNotifications({
      supabase: client as never,
    });

    expect(mockSendAutopayPendingChargeNotification).not.toHaveBeenCalled();
    expect(result.failures).toEqual([
      { groupId: "group-20", reason: "missing_customer_email" },
    ]);
    expect(updates).toEqual([
      {
        table: "autopayment_queue_stock_change",
        values: {
          status: "needs_review",
          last_error: "missing_customer_email",
          notes: "No customer_information.email was found for autopay notification",
        },
        filters: [{ column: "group_id", value: "group-20" }],
      },
    ]);
  });

  it("review path: moves rows to needs_review when customer_information.express_pay is missing", async () => {
    const row = makeQueueRow({
      id: 21,
      group_id: "group-21",
      invoice_id: 9021,
      customer_id: 2021,
    });
    const { client, updates } = createUpdateSupabaseMock();

    mockFetchQueueRows.mockResolvedValue([row]);
    mockFetchCustomerInfoByIds.mockResolvedValue(
      new Map([[2021, makeCustomerInfo({ customer_id: 2021, express_pay: null })]]),
    );

    const result = await sendGroupNotifications({
      supabase: client as never,
    });

    expect(mockSendAutopayPendingChargeNotification).not.toHaveBeenCalled();
    expect(result.failures).toEqual([
      { groupId: "group-21", reason: "missing_express_pay" },
    ]);
    expect(updates).toEqual([
      {
        table: "autopayment_queue_stock_change",
        values: {
          status: "needs_review",
          last_error: "missing_express_pay",
          notes: "No customer_information.express_pay was found for autopay notification",
        },
        filters: [{ column: "group_id", value: "group-21" }],
      },
    ]);
  });

  it("review path: moves rows to needs_review when customer_id is missing", async () => {
    const row = makeQueueRow({
      id: 25,
      group_id: "group-25",
      invoice_id: 9025,
      customer_id: null,
    });
    const { client, updates } = createUpdateSupabaseMock();

    mockFetchQueueRows.mockResolvedValue([row]);
    mockFetchCustomerInfoByIds.mockResolvedValue(new Map());

    const result = await sendGroupNotifications({
      supabase: client as never,
    });

    expect(mockSendAutopayPendingChargeNotification).not.toHaveBeenCalled();
    expect(result.failures).toEqual([
      { id: 25, groupId: "group-25", reason: "missing_customer_id" },
    ]);
    expect(updates).toEqual([
      {
        table: "autopayment_queue_stock_change",
        values: {
          status: "needs_review",
          last_error: "missing_customer_id",
          notes: "Queue row had no customer_id for autopay notification",
        },
        filters: [{ column: "group_id", value: "group-25" }],
      },
    ]);
  });

  it("dry run: counts rows but does not send email or write updates", async () => {
    const row = makeQueueRow({
      id: 30,
      group_id: "group-30",
      invoice_id: 9030,
      customer_id: 2030,
      charge_amount: 75,
    });
    const { client, updates } = createUpdateSupabaseMock();

    mockFetchQueueRows.mockResolvedValue([row]);
    mockFetchCustomerInfoByIds.mockResolvedValue(
      new Map([[2030, makeCustomerInfo({ customer_id: 2030 })]]),
    );

    const result = await sendGroupNotifications({
      supabase: client as never,
      dryRun: true,
    });

    expect(mockSendAutopayPendingChargeNotification).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(result.updatedRows).toBe(1);
    expect(result.failures).toEqual([]);
  });
});
