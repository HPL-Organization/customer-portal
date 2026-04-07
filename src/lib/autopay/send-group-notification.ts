import { sendAutopayPendingChargeNotification } from "@/lib/email/templates/autopay-pending-charge";
import type {
  AutoPayActionResult,
  AutoPayGroup,
  AutoPayQueueRow,
  AutoPayRuntimeOptions,
  AutoPaySupabase,
} from "./types";
import {
  buildCustomerDisplayName,
  describeQueueRow,
  fetchCustomerInfoByIds,
  fetchInvoicesByIds,
  fetchQueueRows,
  fetchSalesOrdersByIds,
  nowPlusDaysIso,
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

export async function sendGroupNotifications(
  options: AutoPayRuntimeOptions & { supabase: AutoPaySupabase },
): Promise<AutoPayActionResult> {
  const { supabase, dryRun = false, debug = false, maxGroups = 25 } = options;
  const rows = await fetchQueueRows(
    supabase,
    options,
    "id, so_id, ns_line_id, line_no, item_id, item_sku, item_display_name, previous_quantity_committed, new_quantity_committed, detected_at, processed_at, status, notes, created_at, quantity, rate, line_amount, committed_delta, charge_amount, customer_id, invoice_id, invoice_ns_line_id, group_id, email_sent_at, charge_after, charge_submitted_at, netsuite_job_id, payment_id, callback_received_at, last_callback_status, last_error, callback_payload",
    (query) =>
      query
        .eq("status", "pending")
        .not("group_id", "is", null)
        .is("email_sent_at", null)
        .is("charge_submitted_at", null),
  );

  const failures: Array<{ id?: number; groupId?: string; reason: string }> = [];

  const rowsWithCustomerId: AutoPayQueueRow[] = [];
  for (const row of rows) {
    const customerId = Number(row.customer_id);
    if (Number.isFinite(customerId) && customerId > 0) {
      rowsWithCustomerId.push(row);
      continue;
    }

    failures.push({ id: row.id, groupId: row.group_id ?? undefined, reason: "missing_customer_id" });
    if (!dryRun && row.group_id) {
      const { error } = await supabase
        .from("autopayment_queue_stock_change")
        .update({
          status: "needs_review",
          last_error: "missing_customer_id",
          notes: "Queue row had no customer_id for autopay notification",
        })
        .eq("group_id", row.group_id);
      if (error) throw error;
    }
  }

  const groups = groupRows(rowsWithCustomerId).slice(0, Math.max(1, maxGroups));
  const customerIds = [...new Set(groups.map((group) => group.customerId))];
  const invoiceIds = [...new Set(groups.map((group) => group.invoiceId))];
  const soIds = [...new Set(groups.flatMap((group) => group.soIds))];
  const customerInfoById = await fetchCustomerInfoByIds(supabase, customerIds);
  const invoicesById = await fetchInvoicesByIds(supabase, invoiceIds);
  const salesOrdersById = await fetchSalesOrdersByIds(supabase, soIds);
  let updatedRows = 0;

  for (const group of groups) {
    const info = customerInfoById.get(group.customerId);
    if (!info) {
      failures.push({ groupId: group.groupId, reason: "missing_customer_info" });
      if (!dryRun) {
        const { error } = await supabase
          .from("autopayment_queue_stock_change")
          .update({
            status: "needs_review",
            last_error: "missing_customer_info",
            notes: "No customer_information row was found for autopay notification",
          })
          .eq("group_id", group.groupId);
        if (error) throw error;
      }
      continue;
    }

    const expressPayInstrumentId = info.express_pay?.trim() || null;
    if (!expressPayInstrumentId) {
      failures.push({ groupId: group.groupId, reason: "missing_express_pay" });
      if (!dryRun) {
        const { error } = await supabase
          .from("autopayment_queue_stock_change")
          .update({
            status: "needs_review",
            last_error: "missing_express_pay",
            notes: "No customer_information.express_pay was found for autopay notification",
          })
          .eq("group_id", group.groupId);
        if (error) throw error;
      }
      continue;
    }

    const email = info.email?.trim() || null;
    if (!email) {
      failures.push({ groupId: group.groupId, reason: "missing_customer_email" });
      if (!dryRun) {
        const { error } = await supabase
          .from("autopayment_queue_stock_change")
          .update({
            status: "needs_review",
            last_error: "missing_customer_email",
            notes: "No customer_information.email was found for autopay notification",
          })
          .eq("group_id", group.groupId);
        if (error) throw error;
      }
      continue;
    }

    const invoice = invoicesById.get(group.invoiceId);
    const soTranIds = group.soIds
      .map((soId) => salesOrdersById.get(soId)?.tran_id?.trim() || null)
      .filter((tranId): tranId is string => Boolean(tranId));

    const chargeAfterIso = nowPlusDaysIso(2);

    if (!dryRun) {
      await sendAutopayPendingChargeNotification({
        to: email,
        firstName: buildCustomerDisplayName(info),
        invoiceTranId: invoice?.tran_id ?? null,
        soTranId: soTranIds[0] ?? null,
        invoiceId: group.invoiceId,
        amount: group.totalChargeAmount,
        chargeAfterIso,
      });

      const { error } = await supabase
        .from("autopayment_queue_stock_change")
        .update({
          status: "notified",
          email_sent_at: new Date().toISOString(),
          charge_after: chargeAfterIso,
          last_error: null,
          notes: null,
        })
        .eq("group_id", group.groupId);
      if (error) throw error;
    }

    updatedRows += group.rowIds.length;
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
