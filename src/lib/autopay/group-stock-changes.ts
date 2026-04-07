import {
  describeQueueRow,
  fetchInvoicesByIds,
  fetchLinksForRows,
  fetchQueueRows,
  makeGroupId,
  serializeError,
  sumChargeAmounts,
  uniqueNumbers,
} from "./utils";
import type {
  AutoPayActionResult,
  AutoPayGroup,
  AutoPayRuntimeOptions,
  AutoPaySupabase,
} from "./types";

export async function groupStockChanges(
  options: AutoPayRuntimeOptions & { supabase: AutoPaySupabase },
): Promise<AutoPayActionResult & { groups: AutoPayGroup[] }> {
  const { supabase, dryRun = false, debug = false } = options;
  const rows = await fetchQueueRows(
    supabase,
    options,
    "id, so_id, ns_line_id, line_no, item_id, item_sku, item_display_name, previous_quantity_committed, new_quantity_committed, detected_at, processed_at, status, notes, created_at, quantity, rate, line_amount, committed_delta, charge_amount, customer_id, invoice_id, invoice_ns_line_id, group_id, email_sent_at, charge_after, charge_submitted_at, netsuite_job_id, payment_id, callback_received_at, last_callback_status, last_error, callback_payload",
    (query) => query.eq("status", "pending").is("group_id", null),
  );

  const failures: Array<{ id?: number; groupId?: string; reason: string }> = [];
  const matchedRows = rows.length;
  if (!rows.length) {
    return {
      scannedRows: 0,
      matchedRows: 0,
      affectedGroups: 0,
      updatedRows: 0,
      skippedRows: 0,
      failures,
      groups: [],
      debug: debug ? { rows: [] } : undefined,
    };
  }

  const linksByRow = await fetchLinksForRows(supabase, rows);
  const candidateInvoiceIds = uniqueNumbers(
    rows.flatMap((row) =>
      (linksByRow.get(`${row.so_id}:${row.ns_line_id}`) || []).map((link) => link.invoice_id),
    ),
  );
  const invoicesById = await fetchInvoicesByIds(supabase, candidateInvoiceIds);

  const groupsByKey = new Map<string, AutoPayGroup>();
  const updates: Array<{ id: number; values: Record<string, unknown> }> = [];

  for (const row of rows) {
    try {
      if (!(Number(row.charge_amount || 0) > 0)) {
        failures.push({ id: row.id, reason: "missing_charge_amount" });
        updates.push({
          id: row.id,
          values: {
            status: "needs_review",
            last_error: "missing_charge_amount",
            notes: "charge_amount was null or <= 0 during grouping",
          },
        });
        continue;
      }

      const links = linksByRow.get(`${row.so_id}:${row.ns_line_id}`) || [];
      const uniqueLinks = new Map<string, (typeof links)[number]>();
      for (const link of links) {
        uniqueLinks.set(
          `${link.invoice_id}:${link.invoice_ns_line_id}`,
          link,
        );
      }

      if (!uniqueLinks.size) {
        failures.push({ id: row.id, reason: "missing_invoice_link" });
        updates.push({
          id: row.id,
          values: {
            status: "needs_review",
            last_error: "missing_invoice_link",
            notes: "No sales_order_invoice_line_links record matched this SO line",
          },
        });
        continue;
      }

      if (uniqueLinks.size > 1) {
        failures.push({ id: row.id, reason: "ambiguous_invoice_link" });
        updates.push({
          id: row.id,
          values: {
            status: "needs_review",
            last_error: "ambiguous_invoice_link",
            notes: "Multiple invoice links matched this SO line; manual review required",
          },
        });
        continue;
      }

      const selectedLink = [...uniqueLinks.values()][0];
      const invoice = invoicesById.get(Number(selectedLink.invoice_id));
      if (!invoice) {
        failures.push({ id: row.id, reason: "missing_invoice_header" });
        updates.push({
          id: row.id,
          values: {
            status: "needs_review",
            last_error: "missing_invoice_header",
            notes: "Invoice header not found for linked invoice",
          },
        });
        continue;
      }

      const invoiceCustomerId = Number(invoice.customer_id);
      if (!Number.isFinite(invoiceCustomerId) || invoiceCustomerId <= 0) {
        failures.push({ id: row.id, reason: "missing_invoice_customer" });
        updates.push({
          id: row.id,
          values: {
            status: "needs_review",
            last_error: "missing_invoice_customer",
            notes: "Linked invoice has no customer_id",
          },
        });
        continue;
      }

      if (
        row.customer_id != null &&
        Number.isFinite(Number(row.customer_id)) &&
        Number(row.customer_id) !== invoiceCustomerId
      ) {
        failures.push({ id: row.id, reason: "customer_mismatch" });
        updates.push({
          id: row.id,
          values: {
            status: "needs_review",
            last_error: "customer_mismatch",
            notes: `Queue row customer_id ${row.customer_id} did not match invoice customer_id ${invoiceCustomerId}`,
          },
        });
        continue;
      }

      const groupKey = `${selectedLink.invoice_id}:${invoiceCustomerId}`;
      const existing = groupsByKey.get(groupKey);
      if (existing) {
        existing.rows.push(row);
        existing.rowIds.push(row.id);
        if (!existing.soIds.includes(row.so_id)) existing.soIds.push(row.so_id);
        existing.totalChargeAmount = sumChargeAmounts(existing.rows);
      } else {
        groupsByKey.set(groupKey, {
          groupId: "",
          invoiceId: Number(selectedLink.invoice_id),
          invoiceTranId: invoice.tran_id ?? null,
          customerId: invoiceCustomerId,
          soIds: [row.so_id],
          totalChargeAmount: Number(row.charge_amount),
          rowIds: [row.id],
          rows: [row],
        });
      }

      updates.push({
        id: row.id,
        values: {
          invoice_id: Number(selectedLink.invoice_id),
          invoice_ns_line_id: Number(selectedLink.invoice_ns_line_id),
          customer_id: invoiceCustomerId,
          last_error: null,
          notes: null,
        },
      });
    } catch (error) {
      failures.push({ id: row.id, reason: serializeError(error) });
      updates.push({
        id: row.id,
        values: {
          status: "needs_review",
          last_error: serializeError(error),
          notes: "Unhandled grouping error",
        },
      });
    }
  }

  const groups = [...groupsByKey.values()].map((group) => ({
    ...group,
    groupId: makeGroupId(group.rowIds, group.invoiceId, group.customerId),
    rowIds: [...group.rowIds].sort((a, b) => a - b),
    soIds: [...group.soIds].sort((a, b) => a - b),
  }));

  for (const group of groups) {
    for (const rowId of group.rowIds) {
      const update = updates.find((entry) => entry.id === rowId);
      if (update) {
        update.values.group_id = group.groupId;
      }
    }
  }

  if (!dryRun) {
    for (const update of updates) {
      const { error } = await supabase
        .from("autopayment_queue_stock_change")
        .update(update.values)
        .eq("id", update.id);
      if (error) throw error;
    }
  }

  return {
    scannedRows: rows.length,
    matchedRows,
    affectedGroups: groups.length,
    updatedRows: updates.length,
    skippedRows: rows.length - updates.length,
    failures,
    groups,
    debug: debug
      ? {
          rows: rows.map(describeQueueRow),
          groups: groups.map((group) => ({
            groupId: group.groupId,
            invoiceId: group.invoiceId,
            customerId: group.customerId,
            rowIds: group.rowIds,
            totalChargeAmount: group.totalChargeAmount,
          })),
        }
      : undefined,
  };
}
