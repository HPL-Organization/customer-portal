export type ExistingSalesOrderLine = {
  so_id: number;
  ns_line_id: number | null;
  line_no: number;
  quantity_committed: number | null;
};

export type IncomingSalesOrderLine = {
  so_id?: number | null;
  line_no?: number | null;
  ns_line_id?: number | null;
  quantity_committed?: number | null;
  is_closed?: boolean | null;
  rate?: number | null;
  quantity?: number | null;
  amount?: number | null;
  item_id?: number | null;
  item_sku?: string | null;
  item_display_name?: string | null;
};

export type AutoPaymentQueueStockChangeCandidate = {
  so_id: number;
  ns_line_id: number;
  line_no: number;
  item_id: number | null;
  item_sku: string | null;
  item_display_name: string | null;
  quantity: number | null;
  rate: number | null;
  line_amount: number | null;
  previous_quantity_committed: number | null;
  new_quantity_committed: number;
  committed_delta: number | null;
  charge_amount: number | null;
  status: "pending";
};

export type AutoPayQueueSkipReason =
  | "invalid_so_or_line_no"
  | "missing_ns_line_id"
  | "line_closed"
  | "missing_existing_line"
  | "previous_committed_null"
  | "committed_not_increased"
  | "non_positive_delta"
  | "duplicate_pending";

export type AutoPayQueueDecision = {
  so_id: number | null;
  ns_line_id: number | null;
  line_no: number | null;
  previous_quantity_committed: number | null;
  new_quantity_committed: number | null;
  committed_delta: number | null;
  pending_key: string | null;
  queued: boolean;
  reason: "queued" | AutoPayQueueSkipReason;
};

function toNumOrNull(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function coerceText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export function buildSalesOrderLineKey(
  soId: number,
  nsLineId: number | null,
  lineNo: number,
) {
  return `${soId}::${nsLineId != null ? nsLineId : `lineNo:${lineNo}`}`;
}

export function analyzeAutoPayQueueRowsForCommittedIncrease(input: {
  lineRows: IncomingSalesOrderLine[];
  existingLinesByKey: Map<string, ExistingSalesOrderLine>;
  existingPendingQueueKeys: Set<string>;
}): {
  queueRows: AutoPaymentQueueStockChangeCandidate[];
  decisions: AutoPayQueueDecision[];
} {
  const { lineRows, existingLinesByKey } = input;
  const seenPendingKeys = new Set(input.existingPendingQueueKeys);
  const queueRows: AutoPaymentQueueStockChangeCandidate[] = [];
  const decisions: AutoPayQueueDecision[] = [];

  for (const row of lineRows) {
    const rawSoId = row.so_id != null ? Number(row.so_id) : null;
    const rawLineNo = row.line_no != null ? Number(row.line_no) : null;
    const soId = Number(row.so_id);
    const lineNo = Number(row.line_no);
    const nsLineId = row.ns_line_id != null ? Number(row.ns_line_id) : null;
    const newCommitted = toNumOrNull(row.quantity_committed) ?? 0;

    if (!Number.isFinite(soId) || !Number.isFinite(lineNo)) {
      decisions.push({
        so_id: rawSoId,
        ns_line_id: nsLineId,
        line_no: rawLineNo,
        previous_quantity_committed: null,
        new_quantity_committed: newCommitted,
        committed_delta: null,
        pending_key: null,
        queued: false,
        reason: "invalid_so_or_line_no",
      });
      continue;
    }
    if (nsLineId == null || !Number.isFinite(nsLineId)) {
      decisions.push({
        so_id: soId,
        ns_line_id: nsLineId,
        line_no: lineNo,
        previous_quantity_committed: null,
        new_quantity_committed: newCommitted,
        committed_delta: null,
        pending_key: null,
        queued: false,
        reason: "missing_ns_line_id",
      });
      continue;
    }
    if (Boolean(row.is_closed)) {
      decisions.push({
        so_id: soId,
        ns_line_id: nsLineId,
        line_no: lineNo,
        previous_quantity_committed: null,
        new_quantity_committed: newCommitted,
        committed_delta: null,
        pending_key: null,
        queued: false,
        reason: "line_closed",
      });
      continue;
    }

    const existing = existingLinesByKey.get(
      buildSalesOrderLineKey(soId, nsLineId, lineNo),
    );
    if (!existing) {
      decisions.push({
        so_id: soId,
        ns_line_id: nsLineId,
        line_no: lineNo,
        previous_quantity_committed: null,
        new_quantity_committed: newCommitted,
        committed_delta: null,
        pending_key: null,
        queued: false,
        reason: "missing_existing_line",
      });
      continue;
    }
    if (existing.quantity_committed == null) {
      decisions.push({
        so_id: soId,
        ns_line_id: nsLineId,
        line_no: lineNo,
        previous_quantity_committed: null,
        new_quantity_committed: newCommitted,
        committed_delta: null,
        pending_key: null,
        queued: false,
        reason: "previous_committed_null",
      });
      continue;
    }

    const previousCommitted = Number(existing.quantity_committed);
    if (!(newCommitted > previousCommitted)) {
      decisions.push({
        so_id: soId,
        ns_line_id: nsLineId,
        line_no: lineNo,
        previous_quantity_committed: previousCommitted,
        new_quantity_committed: newCommitted,
        committed_delta: Number((newCommitted - previousCommitted).toFixed(4)),
        pending_key: null,
        queued: false,
        reason: "committed_not_increased",
      });
      continue;
    }

    const committedDelta = newCommitted - previousCommitted;
    if (!(committedDelta > 0)) {
      decisions.push({
        so_id: soId,
        ns_line_id: nsLineId,
        line_no: lineNo,
        previous_quantity_committed: previousCommitted,
        new_quantity_committed: newCommitted,
        committed_delta: Number(committedDelta.toFixed(4)),
        pending_key: null,
        queued: false,
        reason: "non_positive_delta",
      });
      continue;
    }

    const pendingKey = `${soId}::${nsLineId}::${newCommitted}`;
    if (seenPendingKeys.has(pendingKey)) {
      decisions.push({
        so_id: soId,
        ns_line_id: nsLineId,
        line_no: lineNo,
        previous_quantity_committed: previousCommitted,
        new_quantity_committed: newCommitted,
        committed_delta: Number(committedDelta.toFixed(4)),
        pending_key: pendingKey,
        queued: false,
        reason: "duplicate_pending",
      });
      continue;
    }

    const rate = toNumOrNull(row.rate);
    const chargeAmount =
      rate != null ? Number((committedDelta * rate).toFixed(4)) : null;

    queueRows.push({
      so_id: soId,
      ns_line_id: nsLineId,
      line_no: lineNo,
      item_id: toNumOrNull(row.item_id),
      item_sku: coerceText(row.item_sku),
      item_display_name: coerceText(row.item_display_name),
      quantity: toNumOrNull(row.quantity),
      rate,
      line_amount: toNumOrNull(row.amount),
      previous_quantity_committed: previousCommitted,
      new_quantity_committed: newCommitted,
      committed_delta: Number(committedDelta.toFixed(4)),
      charge_amount: chargeAmount,
      status: "pending",
    });

    seenPendingKeys.add(pendingKey);
    decisions.push({
      so_id: soId,
      ns_line_id: nsLineId,
      line_no: lineNo,
      previous_quantity_committed: previousCommitted,
      new_quantity_committed: newCommitted,
      committed_delta: Number(committedDelta.toFixed(4)),
      pending_key: pendingKey,
      queued: true,
      reason: "queued",
    });
  }

  return { queueRows, decisions };
}

export function buildAutoPayQueueRowsForCommittedIncrease(input: {
  lineRows: IncomingSalesOrderLine[];
  existingLinesByKey: Map<string, ExistingSalesOrderLine>;
  existingPendingQueueKeys: Set<string>;
}): AutoPaymentQueueStockChangeCandidate[] {
  return analyzeAutoPayQueueRowsForCommittedIncrease(input).queueRows;
}
