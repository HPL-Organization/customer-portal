import { beforeEach, describe, expect, it, vi } from "vitest";
import { groupStockChanges } from "../group-stock-changes";
import { makeInvoice, makeLink, makeQueueRow } from "@/test/autopay/factories";
import { createUpdateSupabaseMock } from "@/test/autopay/mock-supabase";

const {
  mockFetchQueueRows,
  mockFetchLinksForRows,
  mockFetchInvoicesByIds,
  mockMakeGroupId,
} = vi.hoisted(() => ({
  mockFetchQueueRows: vi.fn(),
  mockFetchLinksForRows: vi.fn(),
  mockFetchInvoicesByIds: vi.fn(),
  mockMakeGroupId: vi.fn(),
}));

vi.mock("../utils", async () => {
  const actual = await vi.importActual<typeof import("../utils")>("../utils");
  return {
    ...actual,
    fetchQueueRows: mockFetchQueueRows,
    fetchLinksForRows: mockFetchLinksForRows,
    fetchInvoicesByIds: mockFetchInvoicesByIds,
    makeGroupId: mockMakeGroupId,
  };
});

describe("groupStockChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMakeGroupId.mockImplementation(
      (rowIds: number[], invoiceId: number, customerId: number) =>
        `autopay:${invoiceId}:${customerId}:${rowIds.join("-")}`,
    );
  });

  it("grouping success: groups valid queue rows onto one linked invoice", async () => {
    const rowA = makeQueueRow({ id: 1, so_id: 101, ns_line_id: 1, charge_amount: 100 });
    const rowB = makeQueueRow({ id: 2, so_id: 101, ns_line_id: 2, charge_amount: 55.25 });
    const { client, updates } = createUpdateSupabaseMock();

    mockFetchQueueRows.mockResolvedValue([rowA, rowB]);
    mockFetchLinksForRows.mockResolvedValue(
      new Map([
        ["101:1", [makeLink({ so_id: 101, so_ns_line_id: 1, invoice_id: 9001, invoice_ns_line_id: 11 })]],
        ["101:2", [makeLink({ so_id: 101, so_ns_line_id: 2, invoice_id: 9001, invoice_ns_line_id: 12 })]],
      ]),
    );
    mockFetchInvoicesByIds.mockResolvedValue(
      new Map([[9001, makeInvoice({ invoice_id: 9001, customer_id: 2001 })]]),
    );

    const result = await groupStockChanges({
      supabase: client as never,
    });

    expect(result.failures).toEqual([]);
    expect(result.affectedGroups).toBe(1);
    expect(result.updatedRows).toBe(2);
    expect(result.groups).toEqual([
      expect.objectContaining({
        groupId: "autopay:9001:2001:1-2",
        invoiceId: 9001,
        customerId: 2001,
        rowIds: [1, 2],
        totalChargeAmount: 155.25,
      }),
    ]);
    expect(updates).toEqual([
      {
        table: "autopayment_queue_stock_change",
        values: {
          invoice_id: 9001,
          invoice_ns_line_id: 11,
          customer_id: 2001,
          last_error: null,
          notes: null,
          group_id: "autopay:9001:2001:1-2",
        },
        filters: [{ column: "id", value: 1 }],
      },
      {
        table: "autopayment_queue_stock_change",
        values: {
          invoice_id: 9001,
          invoice_ns_line_id: 12,
          customer_id: 2001,
          last_error: null,
          notes: null,
          group_id: "autopay:9001:2001:1-2",
        },
        filters: [{ column: "id", value: 2 }],
      },
    ]);
  });

  it("review path: moves row to needs_review when no invoice link exists", async () => {
    const row = makeQueueRow({ id: 10, so_id: 220, ns_line_id: 4 });
    const { client, updates } = createUpdateSupabaseMock();

    mockFetchQueueRows.mockResolvedValue([row]);
    mockFetchLinksForRows.mockResolvedValue(new Map());
    mockFetchInvoicesByIds.mockResolvedValue(new Map());

    const result = await groupStockChanges({
      supabase: client as never,
    });

    expect(result.failures).toEqual([{ id: 10, reason: "missing_invoice_link" }]);
    expect(result.groups).toEqual([]);
    expect(updates[0]).toEqual({
      table: "autopayment_queue_stock_change",
      values: {
        status: "needs_review",
        last_error: "missing_invoice_link",
        notes: "No sales_order_invoice_line_links record matched this SO line",
      },
      filters: [{ column: "id", value: 10 }],
    });
  });

  it("review path: moves row to needs_review when multiple invoice links match", async () => {
    const row = makeQueueRow({ id: 11, so_id: 221, ns_line_id: 5 });
    const { client, updates } = createUpdateSupabaseMock();

    mockFetchQueueRows.mockResolvedValue([row]);
    mockFetchLinksForRows.mockResolvedValue(
      new Map([
        [
          "221:5",
          [
            makeLink({ so_id: 221, so_ns_line_id: 5, invoice_id: 9001, invoice_ns_line_id: 1 }),
            makeLink({ so_id: 221, so_ns_line_id: 5, invoice_id: 9002, invoice_ns_line_id: 2 }),
          ],
        ],
      ]),
    );
    mockFetchInvoicesByIds.mockResolvedValue(new Map());

    const result = await groupStockChanges({
      supabase: client as never,
    });

    expect(result.failures).toEqual([{ id: 11, reason: "ambiguous_invoice_link" }]);
    expect(updates[0]?.values).toEqual({
      status: "needs_review",
      last_error: "ambiguous_invoice_link",
      notes: "Multiple invoice links matched this SO line; manual review required",
    });
  });

  it("review path: moves row to needs_review when the linked invoice header is missing", async () => {
    const row = makeQueueRow({ id: 12, so_id: 222, ns_line_id: 6 });
    const { client, updates } = createUpdateSupabaseMock();

    mockFetchQueueRows.mockResolvedValue([row]);
    mockFetchLinksForRows.mockResolvedValue(
      new Map([["222:6", [makeLink({ so_id: 222, so_ns_line_id: 6, invoice_id: 9003 })]]]),
    );
    mockFetchInvoicesByIds.mockResolvedValue(new Map());

    const result = await groupStockChanges({
      supabase: client as never,
    });

    expect(result.failures).toEqual([{ id: 12, reason: "missing_invoice_header" }]);
    expect(updates[0]?.values).toEqual({
      status: "needs_review",
      last_error: "missing_invoice_header",
      notes: "Invoice header not found for linked invoice",
    });
  });

  it("review path: moves row to needs_review when the linked invoice is already paid", async () => {
    const row = makeQueueRow({ id: 14, so_id: 224, ns_line_id: 8 });
    const { client, updates } = createUpdateSupabaseMock();

    mockFetchQueueRows.mockResolvedValue([row]);
    mockFetchLinksForRows.mockResolvedValue(
      new Map([["224:8", [makeLink({ so_id: 224, so_ns_line_id: 8, invoice_id: 9005 })]]]),
    );
    mockFetchInvoicesByIds.mockResolvedValue(
      new Map([[9005, makeInvoice({ invoice_id: 9005, amount_remaining: 0 })]]),
    );

    const result = await groupStockChanges({
      supabase: client as never,
    });

    expect(result.failures).toEqual([{ id: 14, reason: "invoice_already_paid" }]);
    expect(updates[0]?.values).toEqual({
      status: "needs_review",
      last_error: "invoice_already_paid",
      notes: "Linked invoice amount_remaining was <= 0",
    });
  });

  it("review path: moves row to needs_review when queue and invoice customers differ", async () => {
    const row = makeQueueRow({ id: 13, so_id: 223, ns_line_id: 7, customer_id: 4001 });
    const { client, updates } = createUpdateSupabaseMock();

    mockFetchQueueRows.mockResolvedValue([row]);
    mockFetchLinksForRows.mockResolvedValue(
      new Map([["223:7", [makeLink({ so_id: 223, so_ns_line_id: 7, invoice_id: 9004 })]]]),
    );
    mockFetchInvoicesByIds.mockResolvedValue(
      new Map([[9004, makeInvoice({ invoice_id: 9004, customer_id: 5001 })]]),
    );

    const result = await groupStockChanges({
      supabase: client as never,
    });

    expect(result.failures).toEqual([{ id: 13, reason: "customer_mismatch" }]);
    expect(updates[0]?.values).toEqual({
      status: "needs_review",
      last_error: "customer_mismatch",
      notes: "Queue row customer_id 4001 did not match invoice customer_id 5001",
    });
  });
});
