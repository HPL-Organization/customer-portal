"use client";

import * as React from "react";
import { Chip, Skeleton, Collapse } from "@mui/material";
import KeyboardArrowDown from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUp from "@mui/icons-material/KeyboardArrowUp";
import PaymentIcon from "@mui/icons-material/Payment";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import FulfillmentPeek from "./FulfillmentPeak";
import { motion } from "framer-motion";

export type Invoice = {
  invoiceId: string | number;
  tranId: string;
  trandate: string;
  total: number;
  taxTotal?: number;
  amountPaid: number;
  amountRemaining: number;
  giveaway?: boolean | null;
  warranty?: boolean | null;
  lines: {
    itemId?: string | number;
    itemName?: string;
    quantity?: number;
    rate?: number;
    amount?: number;
    description?: string | null;
    comment?: string | null;
    itemDisplayName?: string | null;
  }[];
  payments: {
    paymentId?: string | number;
    tranId?: string;
    date?: string;
    paymentDate?: string;
    amount: number;
    status?: string;
    paymentOption?: string;
  }[];
  createdFromSoId: number | null;
  createdFromSoTranId: string | null;
};

function fmt(n: number | undefined) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(Number(n ?? 0));
}
function fdate(d?: string) {
  return d ? new Date(d).toLocaleDateString() : "—";
}

type Row = {
  name: string;
  qty: number;
  rate: number;
  amount: number;
  description: string;
  detail?: string;
};

function computePdfRows(inv: Invoice): { rows: Row[] } {
  const printable = (inv.lines ?? []).filter(isPrintableLine);
  const rows: Row[] = printable.map((l) => {
    const qty = Number(l.quantity ?? 0);
    const rate = Number(l.rate ?? 0);
    const isDiscount = !(rate > 0);
    const amount = isDiscount ? rate : qty * rate;
    return {
      name: (l.itemName ?? String(l.itemId ?? "")) as string,
      detail: getDetail(l),
      qty: isDiscount ? 0 : qty,
      rate,
      amount,
      description: (l.description ?? "") as string,
    };
  });
  return { rows };
}

function fitRect(w: number, h: number, maxW: number, maxH: number) {
  const scale = Math.min(maxW / w, maxH / h, 1);
  return { w: w * scale, h: h * scale };
}

type LogoMeta = { url: string; w: number; h: number } | null;

async function buildAndDownloadPdf(
  inv: Invoice,
  logo?: LogoMeta
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  const marginX = 54;
  let cursorY = 60;

  if (logo?.url && logo.w > 0 && logo.h > 0) {
    try {
      const { w, h } = fitRect(logo.w, logo.h, 140, 48);
      doc.addImage(logo.url, "PNG", marginX, cursorY - 10, w, h);
    } catch {}
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Invoice", 450, cursorY);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const dateStr = inv.trandate
    ? new Date(inv.trandate).toLocaleDateString()
    : "";
  const invNo = (inv.tranId || inv.invoiceId || "—") as string;
  cursorY += 28;
  doc.text(`Invoice #: ${invNo}`, 450, cursorY);
  cursorY += 14;
  if (dateStr) doc.text(`Date: ${dateStr}`, 450, cursorY);

  cursorY += 36;
  doc.setDrawColor(191, 191, 191);
  doc.line(marginX, cursorY, 558, cursorY);
  cursorY += 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  const headers = ["Item", "Detail", "Qty", "Rate", "Amount"];
  const colX = [marginX, 310, 430, 490, 550];
  headers.forEach((h, idx) => doc.text(h, colX[idx], cursorY));
  cursorY += 12;

  doc.setDrawColor(191, 191, 191);
  doc.line(marginX, cursorY, 558, cursorY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  cursorY += 16;

  const { rows } = computePdfRows(inv);
  const lineHeight = 14;
  const bottomY = 700;

  rows.forEach((r) => {
    if (cursorY + lineHeight > bottomY) {
      doc.addPage();
      cursorY = 60;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      headers.forEach((h, idx) => doc.text(h, colX[idx], cursorY));
      cursorY += 12;
      doc.setDrawColor(191, 191, 191);
      doc.line(marginX, cursorY, 558, cursorY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      cursorY += 16;
    }

    const maxItemW = colX[1] - colX[0] - 8;
    const maxDetailW = colX[2] - colX[1] - 8;
    const itemLines = doc.splitTextToSize(r.name || "", maxItemW) as string[];
    const detailLines = doc.splitTextToSize(
      r.detail || "",
      maxDetailW
    ) as string[];
    const blockLines = Math.max(itemLines.length, detailLines.length);
    const blockHeight = Math.max(lineHeight, blockLines * lineHeight);

    itemLines.forEach((ln, i) =>
      doc.text(ln, colX[0], cursorY + i * lineHeight)
    );
    detailLines.forEach((ln, i) =>
      doc.text(ln, colX[1], cursorY + i * lineHeight)
    );

    doc.text(String(r.qty), colX[2], cursorY);
    doc.text(fmt(r.rate), colX[3], cursorY);
    doc.text(fmt(r.amount), colX[4], cursorY);

    cursorY += blockHeight;
  });

  cursorY += 10;
  doc.setDrawColor(191, 191, 191);
  doc.line(marginX, cursorY, 558, cursorY);
  cursorY += 18;

  const headerTotal = Number(inv.total ?? 0);
  const tax = Number.isFinite(Number(inv.taxTotal)) ? Number(inv.taxTotal) : 0;
  const subtotal = Math.max(0, headerTotal - tax);
  const total = headerTotal;
  const paid = Number(inv.amountPaid || 0);
  const remaining = Number(inv.amountRemaining || Math.max(total - paid, 0));

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
  doc.text(fmt(remaining), rightX, cursorY);

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
}

function isPrintableLine(l: Invoice["lines"][number]): boolean {
  const desc = String(l.description ?? "").toLowerCase();
  return !desc.includes("cost of sales");
}
function useMobileLikeLayout() {
  const [isMobileLike, setIsMobileLike] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const update = () => {
      const width = window.innerWidth;
      const isTouch =
        "ontouchstart" in window ||
        (navigator as any).maxTouchPoints > 0 ||
        (navigator as any).msMaxTouchPoints > 0;

      setIsMobileLike(isTouch && width <= 1200);
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return isMobileLike;
}

export default function InvoicesTable({
  loading,
  invoices,
  onPay,
  variant,
}: {
  loading: boolean;
  invoices: Invoice[];
  onPay?: (inv: Invoice) => void;
  variant: "open" | "closed";
}) {
  const [logoMeta, setLogoMeta] = React.useState<LogoMeta>(null);
  const isMobileLike = useMobileLikeLayout();

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/HPL_logo.png");
        if (!res.ok) throw new Error("logo fetch failed");
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          if (!active) return;
          const dataUrl = String(reader.result || "");
          const img = new Image();
          img.onload = () => {
            if (active)
              setLogoMeta({
                url: dataUrl,
                w: img.naturalWidth,
                h: img.naturalHeight,
              });
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(blob);
      } catch {
        setLogoMeta(null);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const onDownload = React.useCallback(
    async (inv: Invoice) => {
      await buildAndDownloadPdf(inv, logoMeta);
    },
    [logoMeta]
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-md">
      {isMobileLike ? (
        loading ? (
          <MobileSkeleton />
        ) : (
          <MobileList
            invoices={invoices}
            onPay={onPay}
            onDownload={onDownload}
            variant={variant}
          />
        )
      ) : loading ? (
        <SkeletonTable />
      ) : (
        <DesktopTable
          invoices={invoices}
          onPay={onPay}
          onDownload={onDownload}
          variant={variant}
        />
      )}
    </div>
  );
}

function DesktopTable({
  invoices,
  onPay,
  onDownload,
  variant,
}: {
  invoices: Invoice[];
  onPay?: (inv: Invoice) => void;
  onDownload: (inv: Invoice) => void;
  variant: "open" | "closed";
}) {
  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-[132px]" />
          <col className="w-[21%]" />
          <col className="w-[14%]" />
          <col className="w-[14%]" />
          <col className="w-[14%]" />
          <col className="w-[14%]" />
          <col className="w-[11%]" />
          <col className="w-[16%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-gradient-to-b from-slate-50 to-white backdrop-blur supports-[backdrop-filter]:bg-white/70">
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <th className="px-3 py-3" />
            <th className="px-4 py-3">Invoice</th>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3 text-right">Total</th>
            <th className="px-4 py-3 text-right">Paid</th>
            <th className="px-4 py-3 text-right">Remaining</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="[&_tr]:border-b [&_tr]:border-slate-200">
          {invoices.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                No invoices.
              </td>
            </tr>
          ) : (
            invoices.map((inv, i) => (
              <DesktopRow
                key={String(inv.invoiceId)}
                index={i}
                inv={inv}
                canPay={variant === "open" && inv.amountRemaining > 0}
                onPay={onPay}
                onDownload={onDownload}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function DesktopRow({
  index,
  inv,
  canPay,
  onPay,
  onDownload,
}: {
  index: number;
  inv: Invoice;
  canPay: boolean;
  onPay?: (inv: Invoice) => void;
  onDownload: (inv: Invoice) => void;
}) {
  const [open, setOpen] = React.useState<boolean>(false);
  const hasBalance = inv.amountRemaining > 0;
  const panelId = `invoice-details-${inv.invoiceId}`;
  const baseBg = index % 2 === 0 ? "bg-slate-50" : "bg-white";
  const openBg = "bg-rose-50";
  const openOutline = "outline outline-2 -outline-offset-2 outline-rose-300/60";
  console.log("Invoices:", inv);

  return (
    <>
      <tr
        className={`transition-colors ${open ? openBg : baseBg} ${
          open ? openOutline : ""
        } ${open ? "" : "hover:bg-slate-100/70"}`}
        aria-selected={open}
        data-open={open ? "true" : "false"}
      >
        <td className="px-2 py-2 align-middle">
          <div className="relative inline-block">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-red-500/25"
              style={{ boxShadow: "0 10px 24px rgba(237,28,36,0.18)" }}
            />
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((s) => !s)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((s) => !s);
                }
              }}
              className="relative z-[1] inline-flex max-w-full items-center gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/40"
              title={open ? "Hide details" : "View invoice details"}
            >
              <span className="inline-grid h-5 w-5 shrink-0 place-items-center rounded-md border border-slate-300 bg-slate-100">
                {open ? (
                  <KeyboardArrowUp fontSize="inherit" />
                ) : (
                  <KeyboardArrowDown fontSize="inherit" />
                )}
              </span>
              <span className="whitespace-nowrap">Details</span>
              <motion.span
                animate={{ rotate: open ? 180 : 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="inline-grid h-4 w-4 shrink-0 place-items-center text-slate-600"
              >
                <KeyboardArrowDown fontSize="inherit" />
              </motion.span>
            </button>
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="font-semibold text-slate-900 tracking-tight">
              {inv.tranId}
            </div>

            {inv.warranty === true && (
              <Chip
                size="small"
                label="Warranty"
                variant="outlined"
                sx={{ borderRadius: "10px" }}
              />
            )}

            {inv.giveaway === true && (
              <Chip
                size="small"
                label="Giveaway"
                variant="outlined"
                sx={{ borderRadius: "10px" }}
              />
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
          {fdate(inv.trandate)}
        </td>
        <td className="px-4 py-3 text-right font-medium text-slate-900">
          {fmt(inv.total)}
        </td>
        <td className="px-4 py-3 text-right text-slate-700">
          {fmt(inv.amountPaid)}
        </td>
        <td className="px-4 py-3 text-right font-semibold">
          <span className={hasBalance ? "text-rose-600" : "text-emerald-700"}>
            {fmt(inv.amountRemaining)}
          </span>
        </td>
        <td className="px-4 py-3 align-middle">
          <Chip
            size="small"
            label={hasBalance ? "Unpaid" : "Paid"}
            color={hasBalance ? "warning" : "success"}
            variant={hasBalance ? "outlined" : "filled"}
            sx={{ borderRadius: "10px" }}
          />
        </td>
        <td className="px-4 py-3 align-middle">
          <div className="flex items-center justify-end gap-2">
            {canPay && onPay && (
              <button
                onClick={() => onPay(inv)}
                className="inline-flex h-9 items-center gap-1 rounded-xl bg-blue-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <PaymentIcon fontSize="inherit" />
                <span className="hidden xl:inline">Pay</span>
              </button>
            )}
            <button
              onClick={() => onDownload(inv)}
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-3.5 text-xs font-semibold text-amber-900 shadow-sm transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              title="Download PDF"
              aria-label="Download PDF"
            >
              <PictureAsPdfIcon fontSize="inherit" />
              <span className="hidden xl:inline">PDF</span>
            </button>
          </div>
        </td>
      </tr>
      <tr>
        <td colSpan={8} className="p-0 align-top">
          <Collapse in={open} timeout="auto" unmountOnExit>
            <div
              className={`border-t border-slate-200 px-3 pt-3 pb-4 md:px-4 ${
                open
                  ? "bg-rose-50/70"
                  : index % 2 === 0
                  ? "bg-slate-50/70"
                  : "bg-white"
              }`}
              id={panelId}
            >
              <Details inv={inv} />
            </div>
          </Collapse>
        </td>
      </tr>
    </>
  );
}

function MobileList({
  invoices,
  onPay,
  onDownload,
  variant,
}: {
  invoices: Invoice[];
  onPay?: (inv: Invoice) => void;
  onDownload: (inv: Invoice) => void;
  variant: "open" | "closed";
}) {
  if (invoices.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-slate-500">No invoices.</div>
    );
  }
  return (
    <div>
      {invoices.map((inv, i) => (
        <MobileCard
          key={String(inv.invoiceId)}
          index={i}
          inv={inv}
          canPay={variant === "open" && inv.amountRemaining > 0}
          onPay={onPay}
          onDownload={onDownload}
        />
      ))}
    </div>
  );
}

function MobileCard({
  inv,
  index,
  canPay,
  onPay,
  onDownload,
}: {
  inv: Invoice;
  index: number;
  canPay: boolean;
  onPay?: (inv: Invoice) => void;
  onDownload: (inv: Invoice) => void;
}) {
  const [open, setOpen] = React.useState<boolean>(false);
  const hasBalance = inv.amountRemaining > 0;
  const panelId = `m-invoice-details-${inv.invoiceId}`;
  const rowBg =
    index % 2 === 0 ? "from-white to-slate-50" : "from-slate-50 to-white";
  const openRing = "ring-2 ring-rose-300/60";

  return (
    <div className="px-4 py-3">
      <div
        className={`rounded-2xl border border-slate-200 bg-gradient-to-b ${rowBg} p-4 shadow-sm transition ${
          open ? openRing : ""
        }`}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="truncate text-base font-semibold text-slate-900">
            {inv.tranId}
          </div>
          <Chip
            size="small"
            label={hasBalance ? "Unpaid" : "Paid"}
            color={hasBalance ? "warning" : "success"}
            variant={hasBalance ? "outlined" : "filled"}
            sx={{ borderRadius: "10px" }}
          />
        </div>

        <div className="mb-3 text-xs text-slate-500">
          Date: {fdate(inv.trandate)}
        </div>

        <div className="mt-1 flex flex-wrap gap-1">
          {inv.warranty === true && (
            <Chip
              size="small"
              label="Warranty"
              variant="outlined"
              sx={{ borderRadius: "10px" }}
            />
          )}
          {inv.giveaway === true && (
            <Chip
              size="small"
              label="Giveaway"
              variant="outlined"
              sx={{ borderRadius: "10px" }}
            />
          )}
        </div>

        <div className="mb-3 grid grid-cols-3 gap-3">
          <Metric label="Total" value={fmt(inv.total)} />
          <Metric label="Paid" value={fmt(inv.amountPaid)} />
          <Metric
            label="Remaining"
            value={fmt(inv.amountRemaining)}
            valueClass={hasBalance ? "text-rose-600" : "text-emerald-700"}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {canPay && onPay ? (
              <button
                onClick={() => onPay(inv)}
                className="inline-flex h-9 items-center gap-1 rounded-xl bg-blue-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <PaymentIcon fontSize="inherit" />
                Pay
              </button>
            ) : null}
            <button
              onClick={() => onDownload(inv)}
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-3.5 text-xs font-semibold text-amber-900 shadow-sm transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              title="Download PDF"
            >
              <PictureAsPdfIcon fontSize="inherit" />
              PDF
            </button>
          </div>
          <div className="relative inline-block">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-red-500/25"
              style={{ boxShadow: "0 10px 24px rgba(237,28,36,0.18)" }}
            />
            <button
              onClick={() => setOpen((s) => !s)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((s) => !s);
                }
              }}
              className="relative z-[1] inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/40"
              aria-expanded={open}
              aria-controls={panelId}
              title={open ? "Hide details" : "View invoice details"}
            >
              <span className="inline-grid h-5 w-5 shrink-0 place-items-center rounded-md border border-slate-300 bg-slate-100">
                {open ? (
                  <KeyboardArrowUp fontSize="inherit" />
                ) : (
                  <KeyboardArrowDown fontSize="inherit" />
                )}
              </span>
              <span>Details</span>
              <motion.span
                animate={{ rotate: open ? 180 : 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="inline-grid h-4 w-4 shrink-0 place-items-center text-slate-600"
              >
                <KeyboardArrowDown fontSize="inherit" />
              </motion.span>
            </button>
          </div>
        </div>

        <Collapse in={open} timeout="auto" unmountOnExit>
          <div id={panelId} className="mt-3 overflow-x-auto">
            <Details inv={inv} mobile />
          </div>
        </Collapse>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl bg-white/70 px-3 py-2 ring-1 ring-slate-200">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={`mt-0.5 tabular-nums text-sm font-semibold ${
          valueClass ?? "text-slate-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function getDetail(l: Invoice["lines"][number]): string {
  const c = (l as any).comment;
  const d = l.description;
  const disp = (l as any).itemDisplayName;
  return String((c ?? d ?? disp ?? "") || "");
}

function SummaryRow({
  label,
  value,
  strong = false,
  highlight = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span
        className={`text-[11px] uppercase tracking-wide ${
          strong
            ? "text-slate-700 font-semibold"
            : "text-slate-500 font-semibold"
        }`}
      >
        {label}
      </span>
      {highlight ? (
        <span className="tabular-nums rounded-lg bg-slate-100 px-2 py-0.5 text-base font-semibold text-slate-900">
          {value}
        </span>
      ) : (
        <span
          className={`tabular-nums ${
            strong
              ? "text-base font-semibold text-slate-900"
              : "font-medium text-slate-900"
          }`}
        >
          {value}
        </span>
      )}
    </div>
  );
}

function Details({ inv, mobile = false }: { inv: Invoice; mobile?: boolean }) {
  return (
    <>
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
        Details
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Line Items
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[820px] w-full table-auto text-sm">
              <colgroup>
                <col className="w-[38%]" />
                <col className="w-[30%]" />
                <col className="w-[10%]" />
                <col className="w-[11%]" />
                <col className="w-[11%]" />
              </colgroup>
              <thead className="text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Detail</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="[&>tr]:border-t [&>tr]:border-slate-200 [&>tr:nth-child(odd)]:bg-slate-50/60">
                {(inv.lines ?? []).filter(isPrintableLine).length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-6 text-center text-sm text-slate-500"
                      colSpan={5}
                    >
                      No line items.
                    </td>
                  </tr>
                ) : (
                  (inv.lines ?? [])
                    .filter(isPrintableLine)
                    .map((l, idx: number) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 font-medium text-slate-900 break-words">
                          {l.itemName ?? l.itemId ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-700 break-words">
                          {getDetail(l) || "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">
                          {l.quantity ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">
                          {fmt(l.rate)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-slate-900 whitespace-nowrap">
                          {fmt(l.amount)}
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end px-3 py-3">
            {(() => {
              const headerTotal = Number(inv.total ?? 0);
              const tax = Number(inv.taxTotal ?? 0);
              const subtotal = Math.max(0, headerTotal - tax);
              const total = headerTotal;

              return (
                <div className="w-full max-w-[360px]">
                  <div className="rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/60 p-3 shadow-sm">
                    <div className="space-y-1.5">
                      <SummaryRow label="Subtotal" value={fmt(subtotal)} />
                      <SummaryRow label="Tax" value={fmt(tax)} />
                      <div className="my-1 border-t border-dashed border-slate-200" />
                      <SummaryRow
                        label="Total"
                        value={fmt(total)}
                        strong
                        highlight
                      />
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Related Payments
          </div>
          <div className="overflow-x-auto">
            {(inv.payments ?? []).length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-slate-500">
                No payments recorded.
              </div>
            ) : (
              <table className="min-w-[560px] w-full table-auto text-sm">
                <thead className="text-left text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Transaction</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Method</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-t [&>tr]:border-slate-200 [&>tr:nth-child(odd)]:bg-slate-50/60">
                  {inv.payments.map((p, i: number) => (
                    <tr key={i}>
                      <td className="px-3 py-2">
                        {p.tranId || p.paymentId || "Payment"}
                        {p.status ? (
                          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                            {p.status}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {fdate(p.paymentDate || p.date)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {p.paymentOption ?? "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right font-medium">
                        {fmt(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {/* WIP: don't remove */}
          {/* <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Fulfillment
          </div> */}

          {/* <div className="px-3 py-3">
            <FulfillmentPeek
              soId={inv.createdFromSoId}
              soTranId={inv.createdFromSoTranId}
              invoiceTranId={inv.tranId}
            />
          </div> */}
        </div>
      </div>
    </>
  );
}

function SkeletonTable() {
  return (
    <table className="w-full table-fixed text-sm">
      <colgroup>
        <col className="w-[132px]" />
        <col className="w-[21%]" />
        <col className="w-[14%]" />
        <col className="w-[14%]" />
        <col className="w-[14%]" />
        <col className="w-[16%]" />
        <col className="w-[11%]" />
      </colgroup>
      <thead className="sticky top-0 z-10 bg-gradient-to-b from-slate-50 to-white">
        <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
          <th className="px-3 py-3" />
          <th className="px-4 py-3">Invoice</th>
          <th className="px-4 py-3">Date</th>
          <th className="px-4 py-3 text-right">Total</th>
          <th className="px-4 py-3 text-right">Paid</th>
          <th className="px-4 py-3 text-right">Remaining</th>
          <th className="px-4 py-3">Status</th>
        </tr>
      </thead>
      <tbody className="[&_tr]:border-b [&_tr]:border-slate-200">
        {Array.from({ length: 5 }).map((_, i: number) => (
          <tr key={i} className={i % 2 === 0 ? "bg-slate-50" : "bg-white"}>
            <td className="px-3 py-3">
              <div className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white">
                <KeyboardArrowDown fontSize="small" />
              </div>
            </td>
            <td className="px-4 py-3">
              <Skeleton width={120} />
            </td>
            <td className="px-4 py-3">
              <Skeleton width={90} />
            </td>
            <td className="px-4 py-3 text-right">
              <Skeleton width={70} />
            </td>
            <td className="px-4 py-3 text-right">
              <Skeleton width={70} />
            </td>
            <td className="px-4 py-3 text-right">
              <Skeleton width={80} />
            </td>
            <td className="px-4 py-3">
              <Skeleton width={120} height={26} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MobileSkeleton() {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: 3 }).map((_, i: number) => (
        <div key={i} className="p-4">
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <Skeleton width={100} />
              <Skeleton width={60} height={24} />
            </div>
            <Skeleton width={120} />
            <div className="mt-3 grid grid-cols-3 gap-3">
              <Skeleton height={52} />
              <Skeleton height={52} />
              <Skeleton height={52} />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <Skeleton width={160} height={36} />
              <Skeleton width={110} height={28} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
