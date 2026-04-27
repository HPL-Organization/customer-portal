import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processAutoPayGroups } from "../process-groups";
import { makeInvoice, makeLink, makeQueueRow } from "@/test/autopay/factories";
import { createInMemoryAutoPaySupabase } from "@/test/autopay/in-memory-supabase";
import type {
  CustomerInfoRow,
  PaymentInstrumentRow,
  SalesOrderRow,
} from "../types";

const {
  mockSendAutopayPendingChargeNotification,
  mockSubmitAutoPayRecordPayment,
} = vi.hoisted(() => ({
  mockSendAutopayPendingChargeNotification: vi.fn(),
  mockSubmitAutoPayRecordPayment: vi.fn(),
}));

vi.mock("@/lib/email/templates/autopay-pending-charge", () => ({
  sendAutopayPendingChargeNotification: mockSendAutopayPendingChargeNotification,
}));

vi.mock("../submit-autopay-record-payment", () => ({
  submitAutoPayRecordPayment: mockSubmitAutoPayRecordPayment,
}));

function makeCustomerInfo(
  overrides: Partial<CustomerInfoRow> = {},
): CustomerInfoRow {
  return {
    customer_id: 2001,
    email: "customer@example.com",
    first_name: "Alex",
    company_name: null,
    express_pay: "777",
    ...overrides,
  };
}

function makeSalesOrder(
  overrides: Partial<SalesOrderRow> = {},
): SalesOrderRow {
  return {
    so_id: 101,
    customer_id: 2001,
    tran_id: "SO-101",
    ...overrides,
  };
}

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

function createFixture() {
  const rowA = makeQueueRow({
    id: 1,
    so_id: 101,
    ns_line_id: 1,
    charge_amount: 100,
  });
  const rowB = makeQueueRow({
    id: 2,
    so_id: 101,
    ns_line_id: 2,
    charge_amount: 55.25,
  });

  return createInMemoryAutoPaySupabase({
    autopayment_queue_stock_change: [rowA, rowB],
    sales_order_invoice_line_links: [
      makeLink({
        so_id: 101,
        so_ns_line_id: 1,
        invoice_id: 9001,
        invoice_ns_line_id: 11,
      }),
      makeLink({
        so_id: 101,
        so_ns_line_id: 2,
        invoice_id: 9001,
        invoice_ns_line_id: 12,
      }),
    ],
    invoices: [makeInvoice({ invoice_id: 9001, tran_id: "INV-9001" })],
    sales_orders: [makeSalesOrder()],
    customer_information: [makeCustomerInfo()],
    payment_instruments: [
      makeInstrument({
        instrument_id: "501",
        is_default: true,
      }),
      makeInstrument({
        instrument_id: "777",
      }),
    ],
  });
}

function logStep(message: string) {
  console.info(`[autopay-test] ${message}`);
}

async function runGroupingAndNotifications(
  client: ReturnType<typeof createFixture>["client"],
) {
  return processAutoPayGroups({
    supabase: client,
    runCharges: false,
  });
}

async function runChargeStage(
  client: ReturnType<typeof createFixture>["client"],
) {
  return processAutoPayGroups({
    supabase: client,
    runGrouping: false,
    runNotifications: false,
  });
}

describe("processAutoPayGroups integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    mockSendAutopayPendingChargeNotification.mockResolvedValue(undefined);
    mockSubmitAutoPayRecordPayment.mockResolvedValue({
      jobId: "job-123",
      idempotencyKey: "autopay-job",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("stage 1: grouping", () => {
    it("passes when pending stock-change rows are grouped onto the linked invoice", async () => {
      const { client, tables } = createFixture();

      logStep("The queue rows started in pending.");
      expect(tables.autopayment_queue_stock_change).toEqual([
        expect.objectContaining({ id: 1, status: "pending", group_id: null }),
        expect.objectContaining({ id: 2, status: "pending", group_id: null }),
      ]);

      const result = await processAutoPayGroups({
        supabase: client,
        runNotifications: false,
        runCharges: false,
      });

      expect(result.grouping.failures).toEqual([]);
      expect(result.grouping.affectedGroups).toBe(1);
      logStep(
        "groupStockChanges found the invoice link and grouped both rows onto one invoice/customer.",
      );
      expect(tables.autopayment_queue_stock_change).toEqual([
        expect.objectContaining({
          id: 1,
          invoice_id: 9001,
          customer_id: 2001,
          group_id: expect.stringContaining("autopay:9001:2001:"),
        }),
        expect.objectContaining({
          id: 2,
          invoice_id: 9001,
          customer_id: 2001,
          group_id: expect.stringContaining("autopay:9001:2001:"),
        }),
      ]);
    });
  });

  describe("stage 2: notification", () => {
    it("passes when the grouped rows are emailed and moved to notified", async () => {
      const { client, tables } = createFixture();

      const result = await runGroupingAndNotifications(client);

      expect(result.notifications.failures).toEqual([]);
      logStep(
        "sendGroupNotifications sent the autopay warning email and changed the rows to notified.",
      );
      expect(mockSendAutopayPendingChargeNotification).toHaveBeenCalledWith({
        to: "customer@example.com",
        firstName: "Alex",
        invoiceTranId: "INV-9001",
        soTranId: "SO-101",
        invoiceId: 9001,
        amount: 155.25,
        chargeAfterIso: "2026-03-28T12:00:00.000Z",
      });
      expect(tables.autopayment_queue_stock_change).toEqual([
        expect.objectContaining({
          id: 1,
          status: "notified",
          email_sent_at: "2026-03-26T12:00:00.000Z",
          charge_after: "2026-03-28T12:00:00.000Z",
        }),
        expect.objectContaining({
          id: 2,
          status: "notified",
          email_sent_at: "2026-03-26T12:00:00.000Z",
          charge_after: "2026-03-28T12:00:00.000Z",
        }),
      ]);
    });
  });

  describe("stage 3: charging", () => {
    it("passes when the charge stage uses the preferred method and submits the group", async () => {
      const { client, tables } = createFixture();

      await runGroupingAndNotifications(client);
      vi.setSystemTime(new Date("2026-03-28T12:00:01.000Z"));
      logStep("The test advanced time past charge_after.");

      const result = await runChargeStage(client);
      const firstGroupId = tables.autopayment_queue_stock_change[0]?.group_id;

      expect(result.charges.failures).toEqual([]);
      logStep(
        "submitGroupPayments picked the method whose instrument_id matches customer_information.express_pay.",
      );
      expect(mockSubmitAutoPayRecordPayment).toHaveBeenCalledWith({
        invoiceInternalId: 9001,
        amount: 155.25,
        paymentOptionId: 777,
        groupId: firstGroupId,
      });
      logStep("It called the charge enqueue with that instrument's id.");
      expect(tables.autopayment_queue_stock_change).toEqual([
        expect.objectContaining({
          id: 1,
          status: "submitted",
          charge_submitted_at: "2026-03-28T12:00:01.000Z",
          netsuite_job_id: "job-123",
        }),
        expect.objectContaining({
          id: 2,
          status: "submitted",
          charge_submitted_at: "2026-03-28T12:00:01.000Z",
          netsuite_job_id: "job-123",
        }),
      ]);
      logStep("The queue rows became submitted.");
      expect(tables.invoices).toEqual([
        expect.objectContaining({
          invoice_id: 9001,
          payment_processing: true,
          payment_processing_started_at: "2026-03-28T12:00:01.000Z",
        }),
      ]);
      logStep("The invoice got payment_processing = true.");
    });
  });
});
