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
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, ArrowDown, Search as SearchIcon } from "lucide-react";

import { createBrowserClient } from "@supabase/ssr";
const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type SortKey = "trandate" | "tranId" | "amountRemaining" | "total";

const TAB = {
  UNPAID: 0 as const,
  PROCESSING: 1 as const,
  PAID: 2 as const,
  DEPOSITS: 3 as const,
};
type TabKey = (typeof TAB)[keyof typeof TAB];

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
        const disp = (l as any).itemDisplayName || "";
        const combined =
          sku && disp && sku !== disp ? `${sku} — ${disp}` : sku || disp || "";
        return { ...l, itemName: combined };
      }) || [];
    return { ...inv, tranId: decoratedTranId, lines };
  });
}

function csvEscape(v: any) {
  const s = v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

function computeSubtotalFromLines(inv: Invoice) {
  const headerTotal = Number(inv.total ?? 0);
  const tax = Number(inv.taxTotal ?? 0);
  return Math.max(0, headerTotal - tax);
}
function getLineDetails(l: any, invMemo: string) {
  const parts = [l?.description, l?.details, l?.comment, l?.comments, l?.memo]
    .map((x) => (x == null ? "" : String(x).trim()))
    .filter(Boolean);
  const unique = Array.from(new Set(parts));
  const joined = unique.join(" | ");
  return joined || invMemo;
}

function buildInvoicesCsv(allInvoices: Invoice[]) {
  const header = [
    "Invoice #",
    "Date",
    "Sales Order",
    "Status",
    "Subtotal",
    "Tax",
    "Total",
    "Paid",
    "Remaining",
    "Line #",
    "Item",
    "Details",
    "Qty",
    "Rate",
    "Amount",
  ];
  const rows: string[] = [];
  for (const inv of allInvoices) {
    const dateStr = inv.trandate
      ? new Date(inv.trandate as any).toLocaleDateString()
      : "";

    const headerTotal = Number(inv.total ?? 0);
    const tax = Number(inv.taxTotal ?? 0);
    const subtotal = Math.max(0, headerTotal - tax);
    const total = headerTotal;
    const paid = Number(inv.amountPaid || 0);
    const remaining = Number(inv.amountRemaining || Math.max(total - paid, 0));

    const processing = Boolean((inv as any).paymentProcessing);
    const status = processing
      ? "Processing"
      : remaining > 0
      ? "Unpaid"
      : "Paid";

    const invMemo = String(
      (inv as any).memo ?? (inv as any).message ?? (inv as any).comments ?? ""
    ).trim();
    const lineItems = inv.lines && inv.lines.length ? inv.lines : [null as any];
    let idx = 0;
    for (const l of lineItems) {
      idx += 1;
      const qty = l ? Number(l.quantity || 0) : null;
      const rate = l ? Number(l.rate || 0) : null;
      const isDiscount = l ? !(rate! > 0) : false;
      const lineAmount = l
        ? isDiscount
          ? rate
          : (qty || 0) * (rate || 0)
        : null;
      const details = l ? getLineDetails(l, invMemo) : invMemo;
      rows.push(
        [
          csvEscape(inv.tranId || inv.invoiceId || "—"),
          csvEscape(dateStr),
          csvEscape(inv.createdFromSoTranId || ""),
          csvEscape(status),
          subtotal.toFixed(2),
          tax.toFixed(2),
          total.toFixed(2),
          paid.toFixed(2),
          remaining.toFixed(2),
          csvEscape(String(idx)),
          csvEscape(l ? l.itemName || String(l.itemId || "") : ""),
          csvEscape(details),
          l ? String(isDiscount ? 0 : qty || 0) : "",
          l ? String(rate != null ? rate.toFixed(2) : "") : "",
          l ? String(lineAmount != null ? lineAmount.toFixed(2) : "") : "",
        ].join(",")
      );
    }
  }
  return [header.map(csvEscape).join(","), ...rows].join("\r\n");
}

function downloadCsvFile(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

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

  const [tab, setTab] = React.useState<TabKey>(TAB.UNPAID);
  const [query, setQuery] = React.useState("");
  const [sortBy, setSortBy] = React.useState<SortKey>("trandate");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  const data = React.useMemo(
    () => ({ invoices: cachedInvoices ?? [], deposits: cachedDeposits ?? [] }),
    [cachedInvoices, cachedDeposits]
  );

  const processingInvoices = React.useMemo(
    () =>
      data.invoices.filter((i) =>
        Boolean((i as any).paymentProcessing === true)
      ),
    [data.invoices]
  );

  const openInvoices = React.useMemo(
    () =>
      data.invoices.filter(
        (i) =>
          Number(i.amountRemaining) > 0 &&
          !Boolean((i as any).paymentProcessing === true)
      ),
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

      const invTran = (inv.tranId || "").toLowerCase();
      const invSo = (inv.createdFromSoTranId || "").toLowerCase();
      const invId = String(inv.invoiceId ?? "").toLowerCase();
      const invMemo = String(
        (inv as any).memo ?? (inv as any).message ?? (inv as any).comments ?? ""
      ).toLowerCase();

      if (
        invTran.includes(q) ||
        invSo.includes(q) ||
        invId.includes(q) ||
        invMemo.includes(q)
      ) {
        return true;
      }

      return (inv.lines || []).some((l) => {
        const name = (l.itemName || "").toLowerCase();
        const disp = String((l as any).itemDisplayName ?? "").toLowerCase();
        const desc = String(
          l.description ?? (l as any).details ?? ""
        ).toLowerCase();
        const cmt = String(
          (l as any).comment ?? (l as any).comments ?? (l as any).memo ?? ""
        ).toLowerCase();
        const idStr = String(l.itemId ?? "").toLowerCase();

        return (
          name.includes(q) ||
          disp.includes(q) ||
          desc.includes(q) ||
          cmt.includes(q) ||
          idStr.includes(q)
        );
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
    tab === TAB.UNPAID
      ? filterSort(openInvoices)
      : tab === TAB.PROCESSING
      ? filterSort(processingInvoices)
      : tab === TAB.PAID
      ? filterSort(closedInvoices)
      : [];

  const [payOpen, setPayOpen] = React.useState(false);
  const [payInvoice, setPayInvoice] = React.useState<Invoice | null>(null);

  const [autoPayActive, setAutoPayActive] = React.useState(false);
  const autoStartedRef = React.useRef(false);
  const isOpeningRef = React.useRef(false);
  const lastPaidIdRef = React.useRef<string | null>(null);
  const redirectOpenedRef = React.useRef(false);

  const searchRef = React.useRef<HTMLInputElement>(null);
  const [searchBurst, setSearchBurst] = React.useState(0);

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

      try {
        await supabase
          .from("invoices")
          .update({ payment_processing: true })
          .eq("invoice_id", numericInvoiceId);
      } catch (e) {
        console.warn("Could not set payment_processing flag:", e);
      }

      toast.success(
        `Payment Processing: ${fmt(Number(amount))} applied to ${
          invoice.tranId
        }`
      );
      setPayOpen(false);
      setPayInvoice(null);
      lastPaidIdRef.current = invoice.invoiceId;

      await refresh();

      setTab(TAB.PROCESSING);
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
  const decoratedProcessing = React.useMemo(
    () => decorateInvoices(filterSort(processingInvoices)),
    [processingInvoices, query, sortBy, sortDir]
  );
  const decoratedClosed = React.useMemo(
    () => decorateInvoices(filterSort(closedInvoices)),
    [closedInvoices, query, sortBy, sortDir]
  );

  const [logoDataUrl, setLogoDataUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/HPL_logo.png");
        if (!res.ok) throw new Error("logo fetch failed");
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          if (active) setLogoDataUrl(String(reader.result || ""));
        };
        reader.readAsDataURL(blob);
      } catch {
        setLogoDataUrl(null);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function downloadInvoicePdf(inv: Invoice) {
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "pt", format: "letter" });
      const marginX = 54;
      let cursorY = 60;
      if (logoDataUrl) {
        try {
          doc.addImage(logoDataUrl, "PNG", marginX, cursorY - 10, 120, 40);
        } catch {}
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text("Invoice", 450, cursorY);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      const dateStr = inv.trandate
        ? new Date(inv.trandate as any).toLocaleDateString()
        : new Date().toLocaleDateString();
      const invNo = inv.tranId || inv.invoiceId || "—";
      cursorY += 28;
      doc.text(`Invoice #: ${invNo}`, 450, cursorY);
      cursorY += 14;
      doc.text(`Date: ${dateStr}`, 450, cursorY);
      if (inv.createdFromSoTranId) {
        cursorY += 14;
        doc.text(`SO: ${inv.createdFromSoTranId}`, 450, cursorY);
      }
      cursorY += 36;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text("Bill To", marginX, cursorY);
      doc.text("Ship To", 300, cursorY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      cursorY += 16;
      const bill = (inv as any).billTo || {};
      const ship = (inv as any).shipTo || {};
      const billLines = [
        bill.name,
        bill.address1,
        bill.address2,
        [bill.city, bill.state, bill.zip].filter(Boolean).join(", "),
        bill.country,
        bill.email,
        bill.phone,
      ]
        .filter((x) => x && String(x).trim())
        .map(String);
      const shipLines = [
        ship.name,
        ship.address1,
        ship.address2,
        [ship.city, ship.state, ship.zip].filter(Boolean).join(", "),
        ship.country,
      ]
        .filter((x) => x && String(x).trim())
        .map(String);
      billLines.forEach((line, i) => doc.text(line, marginX, cursorY + 14 * i));
      shipLines.forEach((line, i) => doc.text(line, 300, cursorY + 14 * i));
      const addressBlockHeight =
        Math.max(billLines.length, shipLines.length) * 14;
      cursorY += addressBlockHeight + 24;
      doc.setDrawColor(191, 191, 191);
      doc.line(marginX, cursorY, 558, cursorY);
      cursorY += 18;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      const headers = ["Item", "Qty", "Rate", "Amount"];
      const colX = [marginX, 380, 440, 500];
      headers.forEach((h, idx) => doc.text(h, colX[idx], cursorY));
      cursorY += 12;
      doc.setDrawColor(191, 191, 191);
      doc.line(marginX, cursorY, 558, cursorY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      cursorY += 16;
      const rows = (inv.lines || []).map((l) => {
        const qty = Number(l.quantity || 0);
        const rate = Number(l.rate || 0);
        const isDiscount = !(rate > 0);
        const lineAmount = isDiscount ? rate : qty * rate;
        return {
          name: l.itemName || String(l.itemId || ""),
          qty: isDiscount ? 0 : qty,
          rate,
          amount: lineAmount,
        };
      });
      const lineHeight = 14;
      const bottomY = 700;
      rows.forEach((r) => {
        if (cursorY + lineHeight > bottomY) {
          doc.addPage();
          cursorY = 60;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          const headers = ["Item", "Qty", "Rate", "Amount"];
          const colX = [marginX, 380, 440, 500];
          headers.forEach((h, idx) => doc.text(h, colX[idx], cursorY));
          cursorY += 12;
          doc.setDrawColor(191, 191, 191);
          doc.line(marginX, cursorY, 558, cursorY);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
          cursorY += 16;
        }
        const name = r.name || "";
        const maxNameWidth = colX[1] - colX[0] - 8;
        const nameLines = (doc.splitTextToSize(
          name,
          maxNameWidth
        ) as string[]) || [name];
        const blockHeight = Math.max(lineHeight, nameLines.length * lineHeight);
        nameLines.forEach((ln, i) =>
          doc.text(ln, colX[0], cursorY + i * lineHeight)
        );
        doc.text(String(r.qty), colX[1], cursorY);
        doc.text(fmt(r.rate), colX[2], cursorY);
        doc.text(fmt(r.amount), colX[3], cursorY);
        cursorY += blockHeight;
      });
      cursorY += 10;
      doc.setDrawColor(191, 191, 191);
      doc.line(marginX, cursorY, 558, cursorY);
      cursorY += 18;
      const subtotal =
        rows.reduce(
          (s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0),
          0
        ) || 0;
      const tax = Number((inv as any).taxTotal || 0);
      const total = subtotal + tax;
      const paid = total - Number(inv.amountRemaining || total);
      const rightX = 500;
      const labelX = 400;
      doc.setFont("helvetica", "bold");
      doc.text("Subtotal:", labelX, cursorY);
      doc.setFont("helvetica", "normal");
      doc.text(fmt(subtotal), rightX, cursorY);
      cursorY += 14;
      doc.setFont("helvetica", "bold");
      doc.text("Tax:", labelX, cursorY);
      doc.setFont("helvetica", "normal");
      doc.text(fmt(tax), rightX, cursorY);
      cursorY += 14;
      doc.setFont("helvetica", "bold");
      doc.text("Total:", labelX, cursorY);
      doc.setFont("helvetica", "normal");
      doc.text(fmt(total), rightX, cursorY);
      cursorY += 14;
      doc.setFont("helvetica", "bold");
      doc.text("Paid:", labelX, cursorY);
      doc.setFont("helvetica", "normal");
      doc.text(fmt(paid), rightX, cursorY);
      cursorY += 14;
      doc.setFont("helvetica", "bold");
      doc.text("Amount Due:", labelX, cursorY);
      doc.setFont("helvetica", "normal");
      doc.text(fmt(Number(inv.amountRemaining || 0)), rightX, cursorY);
      cursorY += 40;
      doc.setDrawColor(191, 191, 191);
      doc.line(marginX, cursorY, 558, cursorY);
      cursorY += 18;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.text(
        "Thank you for your business! Please contact us if you have any questions regarding this invoice.",
        marginX,
        cursorY
      );
      const safeName = String(inv.tranId || inv.invoiceId || "invoice").replace(
        /[^\w\-]+/g,
        "_"
      );
      doc.save(`${safeName}.pdf`);
    } catch (e) {
      console.error(e);
      toast.error("Failed to generate PDF");
    }
  }

  const onDownloadAllCsv = React.useCallback(() => {
    const csv = buildInvoicesCsv(decorateInvoices(data.invoices || []));
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsvFile(`invoices_${stamp}.csv`, csv);
  }, [data.invoices]);

  const [burstKey, setBurstKey] = React.useState(0);
  function handleSortClick() {
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    setBurstKey((k) => k + 1);
  }

  const IconSwap = (
    <div className="relative h-4 w-4">
      <AnimatePresence mode="wait" initial={false}>
        {sortDir === "asc" ? (
          <motion.span
            key="asc"
            initial={{ opacity: 0, rotate: -90, y: -6 }}
            animate={{ opacity: 1, rotate: 0, y: 0 }}
            exit={{ opacity: 0, rotate: 90, y: 6 }}
            transition={{ duration: 0.12, ease: "circOut" }}
            className="absolute inset-0 grid place-items-center"
          >
            <ArrowUp className="h-4 w-4" />
          </motion.span>
        ) : (
          <motion.span
            key="desc"
            initial={{ opacity: 0, rotate: -90, y: -6 }}
            animate={{ opacity: 1, rotate: 0, y: 0 }}
            exit={{ opacity: 0, rotate: 90, y: 6 }}
            transition={{ duration: 0.12, ease: "circOut" }}
            className="absolute inset-0 grid place-items-center"
          >
            <ArrowDown className="h-4 w-4" />
          </motion.span>
        )}
      </AnimatePresence>
      <AnimatePresence>
        <motion.span
          key={`ping-${burstKey}`}
          initial={{ scale: 0.8, opacity: 0.25 }}
          animate={{ scale: 1.35, opacity: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="absolute -inset-2 rounded-full border border-[#8C0F0F]/40"
        />
      </AnimatePresence>
    </div>
  );

  const SortDirButton = (
    <motion.button
      onClick={handleSortClick}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.92 }}
      transition={{ duration: 0.08 }}
      className="h-9 w-9 inline-grid place-items-center rounded-xl border border-[#BFBFBF] bg-white text-[#17152A] shadow-sm hover:bg-[#F8F8F3] focus:outline-none"
      aria-label={`Toggle sort direction (${sortDir})`}
      title={`Sort ${sortDir === "asc" ? "ascending" : "descending"}`}
    >
      {IconSwap}
    </motion.button>
  );

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
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
            { label: `Processing: ${processingInvoices.length}` }, // NEW
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

      <div className="mb-5 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="xl:hidden w-full">
          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={() => setTab(TAB.UNPAID)}
              aria-current={tab === TAB.UNPAID}
              className={`h-11 w-full rounded-xl border shadow-sm text-sm font-semibold
        ${
          tab === TAB.UNPAID
            ? "border-[#8C0F0F] bg-[#FFFFEC] text-[#17152A]"
            : "border-[#BFBFBF] bg-white text-[#17152A] hover:bg-[#F8F8F3]"
        }`}
            >
              Unpaid Invoices ({openInvoices.length})
            </button>

            <button
              onClick={() => setTab(TAB.PROCESSING)}
              aria-current={tab === TAB.PROCESSING}
              className={`h-11 w-full rounded-xl border shadow-sm text-sm font-semibold
        ${
          tab === TAB.PROCESSING
            ? "border-[#8C0F0F] bg-[#FFFFEC] text-[#17152A]"
            : "border-[#BFBFBF] bg-white text-[#17152A] hover:bg-[#F8F8F3]"
        }`}
            >
              Payment Processing ({processingInvoices.length})
            </button>

            <button
              onClick={() => setTab(TAB.PAID)}
              aria-current={tab === TAB.PAID}
              className={`h-11 w-full rounded-xl border shadow-sm text-sm font-semibold
        ${
          tab === TAB.PAID
            ? "border-[#8C0F0F] bg-[#FFFFEC] text-[#17152A]"
            : "border-[#BFBFBF] bg-white text-[#17152A] hover:bg-[#F8F8F3]"
        }`}
            >
              Paid Invoices ({closedInvoices.length})
            </button>
            {/* re-enable deposits:
            <button
              onClick={() => setTab(TAB.DEPOSITS)}
              aria-current={tab === TAB.DEPOSITS}
              className={`h-11 w-full rounded-xl border shadow-sm text-sm font-semibold
                ${tab === TAB.DEPOSITS
                  ? "border-[#8C0F0F] bg-[#FFFFEC] text-[#17152A]"
                  : "border-[#BFBFBF] bg-white text-[#17152A] hover:bg-[#F8F8F3]"}`}
            >
              Deposits ({data.deposits.length})
            </button>
            */}
          </div>
        </div>

        {/* Desktop / Tablet: original Tabs */}
        <div className="hidden w-full xl:block">
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
            <Tab label="Unpaid Invoices" value={TAB.UNPAID} />
            <Tab label="Payment Processing" value={TAB.PROCESSING} />
            <Tab label="Paid Invoices" value={TAB.PAID} />
            {/* <Tab label="Deposits" value={TAB.DEPOSITS} /> */}
          </Tabs>
        </div>

        {/* Right-side controls*/}
        {tab !== TAB.DEPOSITS && (
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
            <div className="relative">
              <motion.button
                type="button"
                onClick={() => searchRef.current?.focus()}
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.92, rotate: -8 }}
                transition={{ duration: 0.08 }}
                className="absolute left-2 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded-md"
                aria-label="Focus search"
                title="Search"
              >
                <SearchIcon className="h-4 w-4 text-[#17152A]/70" />
                <AnimatePresence>
                  <motion.span
                    key={`s-ping-${searchBurst}`}
                    initial={{ scale: 0.7, opacity: 0.25 }}
                    animate={{ scale: 1.35, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    className="absolute -inset-2 rounded-full border border-[#8C0F0F]/35"
                  />
                </AnimatePresence>
              </motion.button>

              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchBurst((k) => k + 1);
                }}
                onFocus={() => setSearchBurst((k) => k + 1)}
                placeholder="Search"
                className="h-9 w-full max-w-xs md:w-56 md:max-w-none shrink-0 rounded-xl border border-[#BFBFBF] bg-white pl-9 pr-3 text-sm text-[#17152A] shadow-sm outline-none placeholder:text-[#17152A]/45 focus:ring-2 focus:ring-[#8C0F0F]/30"
              />
            </div>

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
              {SortDirButton}
            </div>

            <button
              onClick={onDownloadAllCsv}
              className="h-9 rounded-xl border border-[#BFBFBF] bg-white px-3 text-sm font-semibold text-[#17152A] shadow-sm hover:bg-[#F8F8F3] ml-0 md:ml-2 shrink-0"
              title="Download CSV of all invoices"
            >
              Download CSV
            </button>
          </div>
        )}
      </div>

      {tab === TAB.UNPAID && (
        <InvoicesTable
          loading={billingLoading || !initialized}
          invoices={decoratedOpen}
          onPay={onPay}
          onDownload={downloadInvoicePdf}
          variant="open"
        />
      )}
      {tab === TAB.PROCESSING && (
        <InvoicesTable
          loading={billingLoading || !initialized}
          invoices={decoratedProcessing}
          variant="open"
          onDownload={downloadInvoicePdf}
        />
      )}
      {tab === TAB.PAID && (
        <InvoicesTable
          loading={billingLoading || !initialized}
          invoices={decoratedClosed}
          onDownload={downloadInvoicePdf}
          variant="closed"
        />
      )}
      {tab === TAB.DEPOSITS && (
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
