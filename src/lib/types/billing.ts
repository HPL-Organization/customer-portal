export interface InvoiceLine {
  itemId: string;
  itemName: string;
  quantity: number;
  rate: number;
  amount: number;
}

export interface InvoicePayment {
  paymentId?: string;
  tranId?: string;
  amount: number;
  date?: string;
  paymentOption?: string | null;
}

export interface Invoice {
  invoiceId: string;
  tranId: string;
  trandate: string; // ISO date
  total: number;
  amountPaid: number;
  amountRemaining: number;
  customerId: string;
  lines: InvoiceLine[];
  payments: InvoicePayment[];
  netsuiteUrl?: string;
}

export interface Deposit {
  depositId: number;
  tranId: string;
  trandate: string; // date string
  status: string;
  total: number;
  appliedTo: null | {
    soId: number;
    soTranId: string;
    netsuiteUrl?: string;
  };
  isFullyApplied: boolean;
  isPartiallyApplied: boolean;
  isAppliedToSO: boolean;
  isUnapplied: boolean;
  isUnappliedToSO: boolean;
  netsuiteUrl?: string;
}

export interface BillingPayload {
  invoices: Invoice[];
  deposits: Deposit[];
}
