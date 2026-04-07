import type {
  AutoPayActionResult,
  AutoPayGroup,
  AutoPayQueueRow,
  AutoPayRuntimeOptions,
  AutoPaySupabase,
} from "./types";
import { submitAutoPayRecordPayment } from "./submit-autopay-record-payment";
import {
  chooseDefaultInstrument,
  describeQueueRow,
  fetchCustomerInfoByIds,
  fetchPaymentInstrumentsByCustomerIds,
  fetchQueueRows,
  serializeError,
  setInvoicePaymentProcessing,
  sumChargeAmounts,
} from "./utils";

function groupRows(rows: AutoPayQueueRow[]): AutoPayGroup[] {
  const out = new Map<string, AutoPayGroup>();
  for (const row of rows) {
    if (!row.group_id || !row.invoice_id || !row.customer_id) continue;
    const key = String(row.group_id);
    const existing = out.get(key);
    if (existing) {
      existing.rows.push(row);
      existing.rowIds.push(row.id);
      if (!existing.soIds.includes(row.so_id)) existing.soIds.push(row.so_id);
      existing.totalChargeAmount = sumChargeAmounts(existing.rows);
      continue;
    }
    out.set(key, {
      groupId: key,
      invoiceId: Number(row.invoice_id),
      invoiceTranId: null,
      customerId: Number(row.customer_id),
      soIds: [row.so_id],
      totalChargeAmount: Number(row.charge_amount || 0),
      rowIds: [row.id],
      rows: [row],
    });
  }
  return [...out.values()];
}

export async function submitGroupPayments(
  options: AutoPayRuntimeOptions & { supabase: AutoPaySupabase },
): Promise<AutoPayActionResult> {
  const { supabase, dryRun = false, debug = false, maxGroups = 25 } = options;
  const rows = await fetchQueueRows(
    supabase,
    options,
    "id, so_id, ns_line_id, line_no, item_id, item_sku, item_display_name, previous_quantity_committed, new_quantity_committed, detected_at, processed_at, status, notes, created_at, quantity, rate, line_amount, committed_delta, charge_amount, customer_id, invoice_id, invoice_ns_line_id, group_id, email_sent_at, charge_after, charge_submitted_at, netsuite_job_id, payment_id, callback_received_at, last_callback_status, last_error, callback_payload",
    (query) =>
      query
        .eq("status", "notified")
        .not("group_id", "is", null)
        .not("email_sent_at", "is", null)
        .is("charge_submitted_at", null)
        .lte("charge_after", new Date().toISOString()),
  );

  const groups = groupRows(rows).slice(0, Math.max(1, maxGroups));
  const customerIds = [...new Set(groups.map((group) => group.customerId))];
  const customerInfoById = await fetchCustomerInfoByIds(supabase, customerIds);
  const instrumentsByCustomer = await fetchPaymentInstrumentsByCustomerIds(
    supabase,
    customerIds,
  );

  const failures: Array<{ id?: number; groupId?: string; reason: string }> = [];
  let updatedRows = 0;
  const submittedInvoiceIds: number[] = [];

  for (const group of groups) {
    const instrument = chooseDefaultInstrument(
      instrumentsByCustomer.get(group.customerId),
      customerInfoById.get(group.customerId)?.express_pay ?? null,
    );

    if (!instrument) {
      failures.push({ groupId: group.groupId, reason: "missing_payment_instrument" });
      if (!dryRun) {
        const { error } = await supabase
          .from("autopayment_queue_stock_change")
          .update({
            status: "needs_review",
            last_error: "missing_payment_instrument",
            notes: "No eligible saved payment instrument found for customer",
          })
          .eq("group_id", group.groupId);
        if (error) throw error;
      }
      continue;
    }

    const paymentOptionId = Number(instrument.instrument_id);
    if (!Number.isFinite(paymentOptionId) || paymentOptionId <= 0) {
      failures.push({ groupId: group.groupId, reason: "invalid_payment_option_id" });
      if (!dryRun) {
        const { error } = await supabase
          .from("autopayment_queue_stock_change")
          .update({
            status: "needs_review",
            last_error: "invalid_payment_option_id",
            notes: `Instrument ${instrument.instrument_id} was not numeric`,
          })
          .eq("group_id", group.groupId);
        if (error) throw error;
      }
      continue;
    }

    try {
      const enqueueResult = dryRun
        ? { jobId: null, idempotencyKey: group.groupId }
        : await submitAutoPayRecordPayment({
            invoiceInternalId: group.invoiceId,
            amount: group.totalChargeAmount,
            paymentOptionId,
            groupId: group.groupId,
          });

      if (!dryRun && !enqueueResult.jobId) {
        throw new Error("Autopay record-payment enqueue returned no jobId");
      }

      if (!dryRun) {
        const { error } = await supabase
          .from("autopayment_queue_stock_change")
          .update({
            status: "submitted",
            charge_submitted_at: new Date().toISOString(),
            netsuite_job_id: enqueueResult.jobId,
            last_error: null,
            notes: null,
          })
          .eq("group_id", group.groupId);
        if (error) throw error;
        submittedInvoiceIds.push(group.invoiceId);
      }

      updatedRows += group.rowIds.length;
    } catch (error) {
      failures.push({ groupId: group.groupId, reason: serializeError(error) });
      if (!dryRun) {
        const { error: updateError } = await supabase
          .from("autopayment_queue_stock_change")
          .update({
            last_error: serializeError(error),
            notes: "Payment submission failed; group left in notified state for retry",
          })
          .eq("group_id", group.groupId);
        if (updateError) throw updateError;
      }
    }
  }

  if (!dryRun && submittedInvoiceIds.length) {
    await setInvoicePaymentProcessing(supabase, submittedInvoiceIds, true);
  }

  return {
    scannedRows: rows.length,
    matchedRows: rows.length,
    affectedGroups: groups.length,
    updatedRows,
    skippedRows: rows.length - updatedRows,
    failures,
    debug: debug
      ? {
          rows: rows.map(describeQueueRow),
          groups: groups.map((group) => ({
            groupId: group.groupId,
            customerId: group.customerId,
            invoiceId: group.invoiceId,
            rowIds: group.rowIds,
            totalChargeAmount: group.totalChargeAmount,
          })),
        }
      : undefined,
  };
}
