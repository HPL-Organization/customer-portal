// src/components/providers/BillingProvider.tsx
"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useCustomerBootstrap } from "./CustomerBootstrap";
import type {
  BillingPayload,
  Invoice,
  Deposit,
  InvoiceLine,
  InvoicePayment,
} from "@/lib/types/billing";

import { fetchWithLimit } from "@/lib/net/limit";

type BillingState = {
  loading: boolean;
  error?: string | null;
  invoices: Invoice[];
  deposits: Deposit[];
  unpaidInvoices: Invoice[];
  customerId: string | null;
  lastLoadedAt?: number | null;
  refresh: () => Promise<void>;
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  allowLiveEventOverride: boolean | null;
  overrideLoading: boolean;
  refreshOverride: () => Promise<void>;
};

const Ctx = createContext<BillingState | undefined>(undefined);

function normLine(raw: any): InvoiceLine {
  const line: any = {
    itemId: String(raw.itemId ?? raw.item?.id ?? ""),
    itemName: String(raw.itemName ?? raw.item?.refName ?? ""),
    quantity: Number(raw.quantity ?? 0),
    rate: Number(raw.rate ?? 0),
    amount: Number(raw.amount ?? 0),
    itemDisplayName:
      raw.itemDisplayName ??
      raw.item?.displayname ??
      raw.item?.displayName ??
      null,
    description:
      raw.description != null
        ? String(raw.description)
        : raw.memo != null
        ? String(raw.memo)
        : "",
    comment:
      raw.comment != null
        ? String(raw.comment)
        : raw.lineComment != null
        ? String(raw.lineComment)
        : raw.linecomment != null
        ? String(raw.linecomment)
        : null,
  };
  return line as InvoiceLine;
}

function normPayment(raw: any): InvoicePayment {
  const opt = (raw.paymentOption ?? raw.paymentoption ?? raw.method ?? "")
    .toString()
    .trim();

  return {
    paymentId:
      raw.paymentId != null
        ? String(raw.paymentId)
        : raw.paymentid != null
        ? String(raw.paymentid)
        : undefined,
    tranId:
      raw.tranId != null
        ? String(raw.tranId)
        : raw.tranid != null
        ? String(raw.tranid)
        : undefined,
    amount: Number(raw.amount ?? 0),
    date:
      raw.paymentDate != null
        ? String(raw.paymentDate)
        : raw.date != null
        ? String(raw.date)
        : undefined,
    paymentOption: opt || null,
  };
}

function normalizeInvoice(raw: any): Invoice {
  const inv: any = {
    invoiceId: String(raw.invoiceId ?? raw.id ?? raw.internalId ?? ""),
    tranId: String(raw.tranId ?? ""),
    trandate: String(raw.trandate ?? raw.tranDate ?? ""),
    total: Number(raw.total ?? 0),
    taxTotal: Number(raw.taxTotal ?? raw.taxtotal ?? 0),
    amountPaid: Number(raw.amountPaid ?? 0),
    amountRemaining: Number(raw.amountRemaining ?? 0),
    customerId: String(raw.customerId ?? raw.entity?.id ?? ""),
    netsuiteUrl: raw.netsuiteUrl != null ? String(raw.netsuiteUrl) : undefined,
    lines: Array.isArray(raw.lines) ? raw.lines.map(normLine) : [],
    payments: Array.isArray(raw.payments) ? raw.payments.map(normPayment) : [],
    createdFromSoId:
      raw.createdFromSoId != null ? Number(raw.createdFromSoId) : null,
    createdFromSoTranId:
      raw.createdFromSoTranId != null ? String(raw.createdFromSoTranId) : null,
    createdFromSoUrl:
      raw.createdFromSoUrl != null ? String(raw.createdFromSoUrl) : undefined,
    paymentProcessing: Boolean((raw.payment_processing ?? false) === true),
    isBackordered:
      typeof raw.isBackordered === "boolean"
        ? raw.isBackordered
        : typeof raw.is_backordered === "boolean"
        ? raw.is_backordered
        : null,
    salesRep:
      raw.salesRep ??
      raw.sales_rep ??
      (typeof raw.salesrep === "string" ? raw.salesrep : null),
  };
  return inv as Invoice;
}

function normalizeDeposit(raw: any): Deposit {
  return {
    depositId: Number(raw.depositId ?? raw.id ?? 0),
    tranId: String(raw.tranId ?? ""),
    trandate: String(raw.trandate ?? ""),
    status: String(raw.status ?? ""),
    total: Number(raw.total ?? 0),
    appliedTo: raw.appliedTo
      ? {
          soId: Number(raw.appliedTo.soId ?? 0),
          soTranId: String(raw.appliedTo.soTranId ?? ""),
          netsuiteUrl:
            raw.appliedTo.netsuiteUrl != null
              ? String(raw.appliedTo.netsuiteUrl)
              : undefined,
        }
      : null,
    isFullyApplied: Boolean(raw.isFullyApplied),
    isPartiallyApplied: Boolean(raw.isPartiallyApplied),
    isAppliedToSO: Boolean(raw.isAppliedToSO),
    isUnapplied: Boolean(raw.isUnapplied),
    isUnappliedToSO: Boolean(raw.isUnappliedToSO),
    netsuiteUrl: raw.netsuiteUrl != null ? String(raw.netsuiteUrl) : undefined,
  };
}

export default function BillingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { nsId, initialized } = useCustomerBootstrap();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);

  const [allowLiveEventOverride, setAllowLiveEventOverride] = useState<
    boolean | null
  >(null);
  const [overrideLoading, setOverrideLoading] = useState(false);

  const fetchBilling = async (signal?: AbortSignal) => {
    if (!nsId) {
      setInvoices([]);
      setDeposits([]);
      setCustomerId(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetchWithLimit(
        `/api/netsuite/invoices?customerId=${encodeURIComponent(nsId)}`,
        { cache: "no-store", signal },
        { maxConcurrent: 1, retries: 3 }
      );
      if (!r.ok) {
        const msg = await r.text();
        throw new Error(msg || `Failed to load invoices (${r.status})`);
      }
      const data: BillingPayload & { customerId?: number | string } =
        await r.json();
      const invs = Array.isArray(data?.invoices)
        ? data.invoices.map(normalizeInvoice)
        : [];
      const deps = Array.isArray(data?.deposits)
        ? data.deposits.map(normalizeDeposit)
        : [];
      setInvoices(invs);
      setDeposits(deps);
      setCustomerId(String(data?.customerId ?? nsId));
      setLastLoadedAt(Date.now());
    } catch (e: any) {
      if (e?.name !== "AbortError")
        setError(e?.message || "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  };

  const fetchOverride = async (signal?: AbortSignal) => {
    if (!nsId) {
      setAllowLiveEventOverride(null);
      setOverrideLoading(false);
      return;
    }
    setOverrideLoading(true);
    try {
      const r = await fetchWithLimit(
        `/api/netsuite/check-live-event-override?customerId=${encodeURIComponent(
          nsId
        )}`,
        { cache: "no-store", signal },
        { maxConcurrent: 1, retries: 3 }
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok)
        throw new Error(j?.error || `Override check failed (${r.status})`);
      setAllowLiveEventOverride(Boolean(j?.override));
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setAllowLiveEventOverride(null);
      }
    } finally {
      setOverrideLoading(false);
    }
  };

  useEffect(() => {
    const ac = new AbortController();
    if (initialized) void fetchBilling(ac.signal);
    return () => ac.abort();
  }, [initialized, nsId]);

  useEffect(() => {
    const ac = new AbortController();
    if (initialized) void fetchOverride(ac.signal);
    return () => ac.abort();
  }, [initialized, nsId]);

  const refresh = async () => {
    const ac = new AbortController();
    await fetchBilling(ac.signal);
    ac.abort();
  };

  const refreshOverride = async () => {
    const ac = new AbortController();
    await fetchOverride(ac.signal);
    ac.abort();
  };

  const unpaidInvoices = useMemo(
    () => invoices.filter((inv) => Number(inv.amountRemaining || 0) > 0),
    [invoices]
  );

  const value: BillingState = useMemo(
    () => ({
      loading,
      error,
      invoices,
      deposits,
      unpaidInvoices,
      customerId,
      lastLoadedAt,
      refresh,
      setInvoices,
      allowLiveEventOverride,
      overrideLoading,
      refreshOverride,
    }),
    [
      loading,
      error,
      invoices,
      deposits,
      unpaidInvoices,
      customerId,
      lastLoadedAt,
      allowLiveEventOverride,
      overrideLoading,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBilling() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBilling must be used within BillingProvider");
  return ctx;
}
