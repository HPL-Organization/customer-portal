import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import type {
  AutoPayDatabase,
  AutoPayFilters,
  AutoPayQueueRow,
  AutoPaySupabase,
  CustomerInfoRow,
  InvoiceRow,
  PaymentInstrumentRow,
  ProfileRow,
  SalesOrderRow,
  SoInvoiceLinkRow,
} from "./types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function getAutoPaySupabase(): AutoPaySupabase {
  return createClient<AutoPayDatabase>(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function truthyParam(value: string | null | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function toFiniteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function nowPlusDaysIso(days: number): string {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString();
}

export function makeGroupId(rowIds: number[], invoiceId: number, customerId: number) {
  const normalized = [...new Set(rowIds)].sort((a, b) => a - b);
  const hash = crypto
    .createHash("sha1")
    .update(`${invoiceId}:${customerId}:${normalized.join(",")}`)
    .digest("hex")
    .slice(0, 16);
  return `autopay:${invoiceId}:${customerId}:${hash}`;
}

export async function resolveScopedSoIds(
  supabase: AutoPaySupabase,
  filters: AutoPayFilters,
): Promise<number[] | null> {
  const scoped = new Set<number>();

  if (filters.scopedSoIds?.length) {
    for (const id of filters.scopedSoIds) {
      if (Number.isFinite(id) && id > 0) scoped.add(id);
    }
  }

  if (filters.customerId) {
    const { data, error } = await supabase
      .from("sales_orders")
      .select("so_id")
      .eq("customer_id", filters.customerId);

    if (error) throw error;
    for (const row of data || []) {
      const soId = Number(row.so_id);
      if (Number.isFinite(soId) && soId > 0) scoped.add(soId);
    }
  }

  if (filters.soId) scoped.add(filters.soId);

  if (!scoped.size) return null;
  return [...scoped];
}

type QueueQuery = {
  in: (column: string, values: number[]) => QueueQuery;
  eq: (column: string, value: string | number | null) => QueueQuery;
  is: (column: string, value: null) => QueueQuery;
  not: (column: string, op: string, value: unknown) => QueueQuery;
  lte: (column: string, value: string) => QueueQuery;
  order: (
    column: string,
    options: { ascending: boolean },
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function applyQueueFilters(
  query: QueueQuery,
  filters: AutoPayFilters,
) {
  if (filters.queueIds?.length) query = query.in("id", filters.queueIds);

  const soIds = filters.scopedSoIds?.length ? filters.scopedSoIds : null;
  if (soIds?.length) query = query.in("so_id", soIds);
  else if (filters.soId) query = query.eq("so_id", filters.soId);

  if (filters.customerId && !soIds?.length) {
    query = query.eq("customer_id", filters.customerId);
  }

  return query;
}

export async function fetchQueueRows(
  supabase: AutoPaySupabase,
  filters: AutoPayFilters,
  select: string,
  apply: (query: QueueQuery) => QueueQuery,
): Promise<AutoPayQueueRow[]> {
  let query = supabase
    .from("autopayment_queue_stock_change")
    .select(select) as unknown as QueueQuery;
  query = apply(query);
  const orderedQuery = applyQueueFilters(query, filters).order("detected_at", {
    ascending: true,
  });
  const { data, error } = await orderedQuery;
  if (error) throw error;
  return (data || []) as AutoPayQueueRow[];
}

export async function fetchLinksForRows(
  supabase: AutoPaySupabase,
  rows: AutoPayQueueRow[],
): Promise<Map<string, SoInvoiceLinkRow[]>> {
  const soIds = [...new Set(rows.map((row) => Number(row.so_id)).filter((n) => Number.isFinite(n) && n > 0))];
  const out = new Map<string, SoInvoiceLinkRow[]>();

  for (const ids of chunk(soIds, 500)) {
    const { data, error } = await supabase
      .from("sales_order_invoice_line_links")
      .select("so_id, so_ns_line_id, invoice_id, invoice_ns_line_id")
      .in("so_id", ids);

    if (error) throw error;

    for (const row of (data || []) as SoInvoiceLinkRow[]) {
      const key = `${row.so_id}:${row.so_ns_line_id}`;
      const list = out.get(key) || [];
      list.push(row);
      out.set(key, list);
    }
  }

  return out;
}

export async function fetchInvoicesByIds(
  supabase: AutoPaySupabase,
  invoiceIds: number[],
): Promise<Map<number, InvoiceRow>> {
  const out = new Map<number, InvoiceRow>();
  for (const ids of chunk(invoiceIds, 500)) {
    const { data, error } = await supabase
      .from("invoices")
      .select(
        "invoice_id, tran_id, customer_id, amount_remaining, payment_processing, payment_processing_started_at",
      )
      .in("invoice_id", ids);
    if (error) throw error;
    for (const row of (data || []) as InvoiceRow[]) {
      out.set(Number(row.invoice_id), row);
    }
  }
  return out;
}

export async function fetchCustomerInfoByIds(
  supabase: AutoPaySupabase,
  customerIds: number[],
): Promise<Map<number, CustomerInfoRow>> {
  const out = new Map<number, CustomerInfoRow>();
  for (const ids of chunk(customerIds, 500)) {
    const { data, error } = await supabase
      .from("customer_information")
      .select("customer_id, email, first_name, company_name, express_pay")
      .in("customer_id", ids);
    if (error) throw error;
    for (const row of (data || []) as CustomerInfoRow[]) {
      const id = Number(row.customer_id);
      if (!out.has(id)) out.set(id, row);
    }
  }
  return out;
}

export async function fetchSalesOrdersByIds(
  supabase: AutoPaySupabase,
  soIds: number[],
): Promise<Map<number, SalesOrderRow>> {
  const out = new Map<number, SalesOrderRow>();
  for (const ids of chunk(soIds, 500)) {
    const { data, error } = await supabase
      .from("sales_orders")
      .select("so_id, customer_id, tran_id")
      .in("so_id", ids);
    if (error) throw error;
    for (const row of (data || []) as SalesOrderRow[]) {
      out.set(Number(row.so_id), row);
    }
  }
  return out;
}

export async function fetchProfileEmailByCustomerIds(
  supabase: AutoPaySupabase,
  customerIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const ids of chunk(customerIds, 500)) {
    const { data, error } = await supabase
      .from("profiles")
      .select("netsuite_customer_id, email")
      .in("netsuite_customer_id", ids);
    if (error) throw error;
    for (const row of (data || []) as ProfileRow[]) {
      const id = Number(row.netsuite_customer_id);
      if (Number.isFinite(id) && row.email && !out.has(id)) out.set(id, row.email);
    }
  }
  return out;
}

export async function fetchPaymentInstrumentsByCustomerIds(
  supabase: AutoPaySupabase,
  customerIds: number[],
): Promise<Map<number, PaymentInstrumentRow[]>> {
  const out = new Map<number, PaymentInstrumentRow[]>();
  for (const ids of chunk(customerIds, 500)) {
    const { data, error } = await supabase
      .from("payment_instruments")
      .select(
        "customer_id, instrument_id, payment_method, brand, last4, payer_email, is_default, netsuite_writes_status, ns_deleted_at",
      )
      .in("customer_id", ids)
      .is("ns_deleted_at", null)
      .order("instrument_id", { ascending: true });

    if (error) throw error;

    for (const row of (data || []) as PaymentInstrumentRow[]) {
      const customerId = Number(row.customer_id);
      const list = out.get(customerId) || [];
      list.push(row);
      out.set(customerId, list);
    }
  }
  return out;
}

export function chooseDefaultInstrument(
  rows: PaymentInstrumentRow[] | undefined,
  preferredInstrumentId?: string | null,
): PaymentInstrumentRow | null {
  if (!rows?.length) return null;
  const eligible = rows.filter((row) => {
    const status = String(row.netsuite_writes_status || "").toLowerCase();
    return status !== "failed" && status !== "processing";
  });
  if (!preferredInstrumentId) return null;
  return (
    eligible.find(
      (row) => String(row.instrument_id) === String(preferredInstrumentId),
    ) || null
  );
}

export async function setInvoicePaymentProcessing(
  supabase: AutoPaySupabase,
  invoiceIds: number[],
  processing: boolean,
) {
  const nowIso = new Date().toISOString();
  for (const ids of chunk(invoiceIds, 500)) {
    const { error } = await supabase
      .from("invoices")
      .update({
        payment_processing: processing,
        payment_processing_started_at: processing ? nowIso : null,
      })
      .in("invoice_id", ids);
    if (error) throw error;
  }
}

export function uniqueNumbers(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => Number.isFinite(value as number) && Number(value) > 0).map(Number))];
}

export function sumChargeAmounts(rows: AutoPayQueueRow[]): number {
  return Number(
    rows.reduce((sum, row) => sum + Number(row.charge_amount || 0), 0).toFixed(4),
  );
}

export function describeQueueRow(row: AutoPayQueueRow) {
  return {
    id: row.id,
    so_id: row.so_id,
    ns_line_id: row.ns_line_id,
    invoice_id: row.invoice_id,
    customer_id: row.customer_id,
    charge_amount: row.charge_amount,
    group_id: row.group_id,
    status: row.status,
    email_sent_at: row.email_sent_at,
    charge_after: row.charge_after,
    charge_submitted_at: row.charge_submitted_at,
    netsuite_job_id: row.netsuite_job_id,
    last_error: row.last_error,
  };
}

export function buildCustomerDisplayName(info?: CustomerInfoRow | null) {
  const first = info?.first_name?.trim();
  if (first) return first;
  const company = info?.company_name?.trim();
  if (company) return company;
  return "there";
}

export function coalesceEmail(
  customerInfo: CustomerInfoRow | undefined,
  profileEmail: string | undefined,
  instrumentEmail?: string | null,
): string | null {
  return (
    instrumentEmail?.trim() ||
    customerInfo?.email?.trim() ||
    profileEmail?.trim() ||
    null
  );
}

export function serializeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
