import type { SupabaseClient } from "@supabase/supabase-js";

export type AutoPayQueueRow = {
  id: number;
  so_id: number;
  ns_line_id: number;
  line_no: number | null;
  item_id: number | null;
  item_sku: string | null;
  item_display_name: string | null;
  previous_quantity_committed: number | null;
  new_quantity_committed: number;
  detected_at: string;
  processed_at: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  quantity: number | null;
  rate: number | null;
  line_amount: number | null;
  committed_delta: number | null;
  charge_amount: number | null;
  customer_id: number | null;
  invoice_id: number | null;
  invoice_ns_line_id: number | null;
  group_id: string | null;
  email_sent_at: string | null;
  charge_after: string | null;
  charge_submitted_at: string | null;
  netsuite_job_id: string | null;
  payment_id: string | null;
  callback_received_at: string | null;
  last_callback_status: string | null;
  last_error: string | null;
  callback_payload: unknown;
};

export type SoInvoiceLinkRow = {
  so_id: number;
  so_ns_line_id: number;
  invoice_id: number;
  invoice_ns_line_id: number;
};

export type InvoiceRow = {
  invoice_id: number;
  tran_id: string | null;
  customer_id: number | null;
  amount_remaining: number | null;
  payment_processing: boolean | null;
  payment_processing_started_at: string | null;
};

export type SalesOrderRow = {
  so_id: number;
  customer_id: number | null;
  tran_id: string | null;
};

export type PaymentInstrumentRow = {
  customer_id: number;
  instrument_id: string;
  payment_method: string | null;
  brand: string | null;
  last4: string | null;
  payer_email: string | null;
  is_default: boolean | null;
  netsuite_writes_status: string | null;
  ns_deleted_at?: string | null;
};

export type CustomerInfoRow = {
  customer_id: number;
  email: string | null;
  first_name: string | null;
  company_name: string | null;
  express_pay: string | null;
};

export type ProfileRow = {
  netsuite_customer_id: number | null;
  email: string | null;
};

export type AutoPayDatabase = {
  public: {
    Tables: {
      autopayment_queue_stock_change: {
        Row: AutoPayQueueRow;
        Insert: Partial<AutoPayQueueRow>;
        Update: Partial<AutoPayQueueRow>;
        Relationships: [];
      };
      sales_order_invoice_line_links: {
        Row: SoInvoiceLinkRow;
        Insert: Partial<SoInvoiceLinkRow>;
        Update: Partial<SoInvoiceLinkRow>;
        Relationships: [];
      };
      invoices: {
        Row: InvoiceRow;
        Insert: Partial<InvoiceRow>;
        Update: Partial<InvoiceRow>;
        Relationships: [];
      };
      sales_orders: {
        Row: SalesOrderRow;
        Insert: Partial<SalesOrderRow>;
        Update: Partial<SalesOrderRow>;
        Relationships: [];
      };
      payment_instruments: {
        Row: PaymentInstrumentRow;
        Insert: Partial<PaymentInstrumentRow>;
        Update: Partial<PaymentInstrumentRow>;
        Relationships: [];
      };
      customer_information: {
        Row: CustomerInfoRow;
        Insert: Partial<CustomerInfoRow>;
        Update: Partial<CustomerInfoRow>;
        Relationships: [];
      };
      profiles: {
        Row: ProfileRow;
        Insert: Partial<ProfileRow>;
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type AutoPaySupabase = SupabaseClient<AutoPayDatabase>;

export type AutoPayFilters = {
  customerId?: number | null;
  soId?: number | null;
  queueIds?: number[];
  scopedSoIds?: number[] | null;
};

export type AutoPayRuntimeOptions = AutoPayFilters & {
  dryRun?: boolean;
  debug?: boolean;
  maxGroups?: number;
};

export type AutoPayGroup = {
  groupId: string;
  invoiceId: number;
  invoiceTranId: string | null;
  customerId: number;
  soIds: number[];
  totalChargeAmount: number;
  rowIds: number[];
  rows: AutoPayQueueRow[];
};

export type AutoPayActionResult = {
  scannedRows: number;
  matchedRows: number;
  affectedGroups: number;
  updatedRows: number;
  skippedRows: number;
  failures: Array<{ id?: number; groupId?: string; reason: string }>;
  debug?: unknown;
};
