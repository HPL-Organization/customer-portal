"use client";

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "react-toastify";
import InvoicesTable from "../../../components/invoices/InvoiceTable";
import DepositsTable from "../../../components/invoices/DepositTable";
import PayDrawer from "../../../components/invoices/PayDrawer";
import type { Invoice } from "@/lib/types/billing";
import { useCustomerBootstrap } from "@/components/providers/CustomerBootstrap";
import { useBilling } from "@/components/providers/BillingProvider";
import {
  Tabs,
  Tab,
  Chip,
  Backdrop,
  CircularProgress,
  LinearProgress,
  Portal,
  Typography,
  Box,
} from "@mui/material";

/* ---------- helpers ---------- */
type SortKey = "trandate" | "tranId" | "amountRemaining" | "total";

function fmt(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function decorateInvoices(list: Invoice[]): Invoice[] {
  return list.map((inv) => {
    const soSuffix = inv.createdFromSoTranId
      ? ` · ${inv.createdFromSoTranId}`
      : "";
    const decoratedTranId = inv.tranId
      ? `${inv.tranId}${soSuffix}`
      : inv.tranId;
    const lines =
      (inv.lines || []).map((l) => {
        const sku = l.itemName || (l.itemId != null ? String(l.itemId) : "");
        const disp = l.itemDisplayName || "";
        const combined =
          sku && disp && sku !== disp ? `${sku} — ${disp}` : sku || disp || "";
        return { ...l, itemName: combined };
      }) || [];
    return { ...inv, tranId: decoratedTranId, lines };
  });
}

/* ---------- page ---------- */
export default function InvoicesPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const redirectUrl = React.useMemo(() => {
    const raw = sp.get("redirect");
    try {
      return raw ? decodeURIComponent(raw) : null;
    } catch {
      return raw || null;
    }
  }, [sp]);

  const { nsId: providerNsId, initialized } = useCustomerBootstrap();
  const {
    invoices: cachedInvoices,
    deposits: cachedDeposits,
    loading: billingLoading,
    refresh,
  } = useBilling();

  const [tab, setTab] = React.useState<0 | 1 | 2>(0);
  const [query, setQuery] = React.useState("");
  const [sortBy, setSortBy] = React.useState<SortKey>("trandate");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  const data = React.useMemo(
    () => ({ invoices: cachedInvoices ?? [], deposits: cachedDeposits ?? [] }),
    [cachedInvoices, cachedDeposits]
  );

  const openInvoices = React.useMemo(
    () => data.invoices.filter((i) => Number(i.amountRemaining) > 0),
    [data.invoices]
  );
  const closedInvoices = React.useMemo(
    () => data.invoices.filter((i) => Number(i.amountRemaining) <= 0),
    [data.invoices]
  );

  const LOADING_STEPS = [
    "Loading your invoices…",
    "Fetching your payments…",
    "Processing your deposits…",
    "Finishing up…",
  ] as const;

  const [loadStepIndex, setLoadStepIndex] = React.useState(0);
  const stepTimerRef = React.useRef<number | null>(null);

  function filterSort(list: Invoice[]) {
    const q = query.trim().toLowerCase();
    const filtered = list.filter((inv) => {
      if (!q) return true;
      if (inv.tranId?.toLowerCase().includes(q)) return true;
      if (
        inv.createdFromSoTranId &&
        inv.createdFromSoTranId.toLowerCase().includes(q)
      )
        return true;
      return (inv.lines || []).some((l) => {
        const name = l.itemName?.toLowerCase() || "";
        const disp = (l as any).itemDisplayName?.toLowerCase?.() || "";
        const idStr = String(l.itemId ?? "");
        return name.includes(q) || disp.includes(q) || idStr.includes(q);
      });
    });

    const sorted = [...filtered].sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;
      switch (sortBy) {
        case "trandate":
          va = new Date(a.trandate as any).getTime();
          vb = new Date(b.trandate as any).getTime();
          break;
        case "tranId":
          va = a.tranId ?? "";
          vb = b.tranId ?? "";
          break;
        case "amountRemaining":
          va = Number(a.amountRemaining || 0);
          vb = Number(b.amountRemaining || 0);
          break;
        case "total":
          va = Number(a.total || 0);
          vb = Number(b.total || 0);
          break;
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }

  const viewInvoices =
    tab === 0
      ? filterSort(openInvoices)
      : tab === 1
      ? filterSort(closedInvoices)
      : [];

  const [payOpen, setPayOpen] = React.useState(false);
  const [payInvoice, setPayInvoice] = React.useState<Invoice | null>(null);

  const [autoPayActive, setAutoPayActive] = React.useState(false);
  const autoStartedRef = React.useRef(false);
  const isOpeningRef = React.useRef(false);
  const lastPaidIdRef = React.useRef<string | null>(null);
  const redirectOpenedRef = React.useRef(false);

  const stopAutoPay = React.useCallback(() => {
    setAutoPayActive(false);
    const params = new URLSearchParams(sp.toString());
    params.delete("autopay");
    router.replace(
      `/invoices${params.toString() ? `?${params.toString()}` : ""}`
    );
  }, [router, sp]);

  React.useEffect(() => {
    const wantsAuto = sp.get("autopay") === "1";
    if (!autoStartedRef.current && wantsAuto) {
      autoStartedRef.current = true;
      setAutoPayActive(true);
    }
  }, [sp]);

  const openNextInvoice = React.useCallback(() => {
    if (!autoPayActive || isOpeningRef.current) return;
    isOpeningRef.current = true;

    let next = openInvoices[0];

    if (next && next.invoiceId === lastPaidIdRef.current && !payOpen) {
      lastPaidIdRef.current = null;
    }

    if (next) {
      if (payInvoice?.invoiceId !== next.invoiceId || !payOpen) {
        setPayInvoice(next);
        setPayOpen(true);
      }
    } else {
      setPayInvoice(null);
      setPayOpen(false);
      setAutoPayActive(false);
      const params = new URLSearchParams(sp.toString());
      params.delete("autopay");
      params.delete("redirect");
      if (redirectUrl) {
        router.replace(redirectUrl);
      } else {
        toast.success("All open invoices are paid. Thank you!");
        router.replace(
          `/invoices${params.toString() ? `?${params.toString()}` : ""}`
        );
      }
    }

    queueMicrotask(() => {
      isOpeningRef.current = false;
    });
  }, [
    autoPayActive,
    openInvoices,
    payInvoice?.invoiceId,
    payOpen,
    router,
    sp,
    redirectUrl,
  ]);

  React.useEffect(() => {
    if (autoPayActive && !billingLoading && initialized) {
      if (!payOpen) openNextInvoice();
    }
  }, [autoPayActive, billingLoading, initialized, payOpen, openNextInvoice]);

  const onPay = (inv: Invoice) => {
    setPayInvoice(inv);
    setPayOpen(true);
  };

  const formatLocalDate = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const submitPayment = async (
    invoice: Invoice,
    amount: number,
    methodId: string
  ) => {
    try {
      const numericInvoiceId = Number(invoice.invoiceId);
      if (!numericInvoiceId || !(Number(amount) > 0)) {
        throw new Error("Invalid amount or invoice.");
      }

      const externalId = `HPL_${numericInvoiceId}_${Date.now()}`;

      const res = await fetch("/api/netsuite/record-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceInternalId: numericInvoiceId,
          amount: Number(amount),
          undepFunds: true,
          paymentOptionId: Number(methodId),
          memo: "Portal payment",
          externalId,
          trandate: formatLocalDate(),
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) {
        throw new Error(
          json?.details || json?.error || "Failed to record payment"
        );
      }

      toast.success(
        `Payment recorded: ${fmt(Number(amount))} applied to ${invoice.tranId}`
      );
      setPayOpen(false);
      setPayInvoice(null);
      lastPaidIdRef.current = invoice.invoiceId;
      await refresh();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Payment failed");
    }
  };

  const handleCloseDrawer = () => {
    setPayOpen(false);
    setPayInvoice(null);
    lastPaidIdRef.current = null;
    if (autoPayActive) stopAutoPay();
  };

  const openBalance = openInvoices.reduce(
    (s, i) => s + Number(i.amountRemaining || 0),
    0
  );

  const uiLoading = billingLoading || !initialized;

  React.useEffect(() => {
    if (uiLoading) {
      setLoadStepIndex(0);
      if (stepTimerRef.current) {
        window.clearInterval(stepTimerRef.current);
        stepTimerRef.current = null;
      }
      const id = window.setInterval(() => {
        setLoadStepIndex((prev) => {
          if (prev >= LOADING_STEPS.length - 1) {
            if (stepTimerRef.current) {
              window.clearInterval(stepTimerRef.current);
              stepTimerRef.current = null;
            }
            return prev;
          }
          return prev + 1;
        });
      }, 3500);
      stepTimerRef.current = id as unknown as number;
    } else {
      if (stepTimerRef.current) {
        window.clearInterval(stepTimerRef.current);
        stepTimerRef.current = null;
      }
    }
    return () => {
      if (stepTimerRef.current) {
        window.clearInterval(stepTimerRef.current);
        stepTimerRef.current = null;
      }
    };
  }, [uiLoading]);

  const decoratedOpen = React.useMemo(
    () => decorateInvoices(filterSort(openInvoices)),
    [openInvoices, query, sortBy, sortDir]
  );
  const decoratedClosed = React.useMemo(
    () => decorateInvoices(filterSort(closedInvoices)),
    [closedInvoices, query, sortBy, sortDir]
  );

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#17152A]">
            View and pay invoices
          </h1>
          <div className="mt-2 h-[3px] w-24 rounded-full bg-gradient-to-r from-[#8C0F0F] to-[#E01C24]" />
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {[
            { label: `Open Balance: ${fmt(openBalance)}` },
            { label: `Open: ${openInvoices.length}` },
            { label: `Paid: ${closedInvoices.length}` },
            { label: `Deposits: ${data.deposits.length}` },
          ].map((c, i) => (
            <Chip
              key={i}
              size="small"
              label={c.label}
              variant="outlined"
              sx={{
                borderRadius: "10px",
                borderColor: "#BFBFBF",
                color: "#17152A",
                bgcolor: "#FFFFEC",
                "& .MuiChip-label": { px: 1.25 },
              }}
            />
          ))}
        </div>
      </div>

      {/* Tabs + Filters */}
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          aria-label="billing tabs"
          sx={{
            minHeight: 0,
            "& .MuiTab-root": {
              minHeight: 0,
              textTransform: "none",
              fontWeight: 600,
              color: "#17152A",
              opacity: 0.7,
            },
            "& .Mui-selected": { color: "#17152A", opacity: 1 },
            "& .MuiTabs-indicator": {
              height: 3,
              borderRadius: 2,
              background: "linear-gradient(90deg,#8C0F0F,#E01C24)",
            },
          }}
        >
          <Tab label="Unpaid Invoices" value={0} />
          <Tab label="Paid Invoices" value={1} />
          <Tab label="Credits / Deposits" value={2} />
        </Tabs>

        {tab !== 2 && (
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search invoice #, SO #, SKU, or display name…"
              className="h-9 w-full rounded-xl border border-[#BFBFBF] bg-white px-3 text-sm text-[#17152A] shadow-sm outline-none placeholder:text-[#17152A]/45 focus:ring-2 focus:ring-[#8C0F0F]/30 md:w-80"
            />
            <div className="flex items-center gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="h-9 rounded-xl border border-[#BFBFBF] bg-white px-2 text-sm text-[#17152A] shadow-sm focus:ring-2 focus:ring-[#8C0F0F]/30"
              >
                <option value="trandate">Date</option>
                <option value="tranId">Invoice #</option>
                <option value="amountRemaining">Amount Remaining</option>
                <option value="total">Total</option>
              </select>
              <select
                value={sortDir}
                onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
                className="h-9 rounded-xl border border-[#BFBFBF] bg-white px-2 text-sm text-[#17152A] shadow-sm focus:ring-2 focus:ring-[#8C0F0F]/30"
              >
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Tables */}
      {tab === 0 && (
        <InvoicesTable
          loading={billingLoading || !initialized}
          invoices={decoratedOpen}
          onPay={onPay}
          variant="open"
        />
      )}
      {tab === 1 && (
        <InvoicesTable
          loading={billingLoading || !initialized}
          invoices={decoratedClosed}
          variant="closed"
        />
      )}
      {tab === 2 && (
        <DepositsTable
          loading={billingLoading || !initialized}
          deposits={data.deposits}
        />
      )}

      <PayDrawer
        customerId={providerNsId}
        open={payOpen}
        invoice={payInvoice}
        onClose={handleCloseDrawer}
        onSubmit={submitPayment}
      />

      {/* Loading overlay */}
      <Portal>
        <Backdrop
          open={billingLoading || !initialized}
          sx={{
            color: "#fff",
            zIndex: 2147483647,
            flexDirection: "column",
            gap: 2,
          }}
        >
          <CircularProgress />
          <Typography sx={{ fontWeight: 600 }}>
            {LOADING_STEPS[loadStepIndex]}
          </Typography>
          <Box sx={{ width: 320, mt: 1 }}>
            <LinearProgress />
          </Box>
        </Backdrop>
      </Portal>
    </div>
  );
}
