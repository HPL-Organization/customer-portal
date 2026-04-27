import type {
  AutoPayQueueRow,
  InvoiceRow,
  SoInvoiceLinkRow,
} from "@/lib/autopay/types";

export function makeQueueRow(
  overrides: Partial<AutoPayQueueRow> = {},
): AutoPayQueueRow {
  return {
    id: 1,
    so_id: 101,
    ns_line_id: 1,
    line_no: 1,
    item_id: 501,
    item_sku: "SKU-1",
    item_display_name: "Stone",
    previous_quantity_committed: 2,
    new_quantity_committed: 1,
    detected_at: "2026-03-26T10:00:00.000Z",
    processed_at: null,
    status: "pending",
    notes: null,
    created_at: "2026-03-26T10:00:00.000Z",
    quantity: 1,
    rate: 100,
    line_amount: 100,
    committed_delta: -1,
    charge_amount: 100,
    customer_id: 2001,
    invoice_id: null,
    invoice_ns_line_id: null,
    group_id: null,
    email_sent_at: null,
    charge_after: null,
    charge_submitted_at: null,
    netsuite_job_id: null,
    payment_id: null,
    callback_received_at: null,
    last_callback_status: null,
    last_error: null,
    callback_payload: null,
    ...overrides,
  };
}

export function makeLink(
  overrides: Partial<SoInvoiceLinkRow> = {},
): SoInvoiceLinkRow {
  return {
    so_id: 101,
    so_ns_line_id: 1,
    invoice_id: 9001,
    invoice_ns_line_id: 11,
    ...overrides,
  };
}

export function makeInvoice(
  overrides: Partial<InvoiceRow> = {},
): InvoiceRow {
  return {
    invoice_id: 9001,
    tran_id: "INV9001",
    customer_id: 2001,
    amount_remaining: 100,
    payment_processing: false,
    payment_processing_started_at: null,
    ...overrides,
  };
}
