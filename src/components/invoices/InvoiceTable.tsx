"use client";

import * as React from "react";
import { Chip, Skeleton, Collapse } from "@mui/material";
import KeyboardArrowDown from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUp from "@mui/icons-material/KeyboardArrowUp";
import PaymentIcon from "@mui/icons-material/Payment";

export type Invoice = {
  invoiceId: string | number;
  tranId: string;
  trandate: string; // ISO date
  total: number;
  amountPaid: number;
  amountRemaining: number;
  lines: {
    itemId?: string | number;
    itemName?: string;
    quantity?: number;
    rate?: number;
    amount?: number;
    description?: string | null;
  }[];
  payments: {
    paymentId?: string | number;
    tranId?: string;
    date?: string; // older shape
    paymentDate?: string; // route shape
    amount: number;
    status?: string;
    paymentOption?: string;
  }[];
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

export default function InvoicesTable({
  loading,
  invoices,
  onPay,
  variant, // "open" | "closed"
}: {
  loading: boolean;
  invoices: Invoice[];
  onPay?: (inv: Invoice) => void;
  variant: "open" | "closed";
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Desktop (md+) */}
      <div className="hidden md:block">
        {loading ? (
          <SkeletonTable />
        ) : (
          <DesktopTable invoices={invoices} onPay={onPay} variant={variant} />
        )}
      </div>

      {/* Mobile */}
      <div className="md:hidden">
        {loading ? (
          <MobileSkeleton />
        ) : (
          <MobileList invoices={invoices} onPay={onPay} variant={variant} />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Desktop table                                                           */
/* ---------------------------------------------------------------------- */

function DesktopTable({
  invoices,
  onPay,
  variant,
}: {
  invoices: Invoice[];
  onPay?: (inv: Invoice) => void;
  variant: "open" | "closed";
}) {
  return (
    <table className="w-full table-fixed text-sm">
      <colgroup>
        <col className="w-[44px]" />
        <col className="w-[22%]" />
        <col className="w-[14%]" />
        <col className="w-[14%]" />
        <col className="w-[14%]" />
        <col className="w-[16%]" />
        <col className="w-[16%]" />
      </colgroup>

      <thead className="sticky top-0 z-10 bg-gradient-to-b from-slate-50 to-white">
        <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
          <th className="px-3 py-3"> </th>
          <th className="px-4 py-3">Invoice</th>
          <th className="px-4 py-3">Date</th>
          <th className="px-4 py-3 text-right">Total</th>
          <th className="px-4 py-3 text-right">Paid</th>
          <th className="px-4 py-3 text-right">Remaining</th>
          <th className="px-4 py-3">Status</th>
        </tr>
      </thead>

      <tbody>
        {invoices.length === 0 ? (
          <tr>
            <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
              No invoices.
            </td>
          </tr>
        ) : (
          invoices.map((inv) => (
            <DesktopRow
              key={String(inv.invoiceId)}
              inv={inv}
              canPay={variant === "open" && inv.amountRemaining > 0}
              onPay={onPay}
            />
          ))
        )}
      </tbody>
    </table>
  );
}

function DesktopRow({
  inv,
  canPay,
  onPay,
}: {
  inv: Invoice;
  canPay: boolean;
  onPay?: (inv: Invoice) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const hasBalance = inv.amountRemaining > 0;
  const panelId = `invoice-details-${inv.invoiceId}`;

  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-slate-50/60">
        <td className="px-2 py-2 align-middle">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((s) => !s)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
            title={open ? "Hide details" : "Show details"}
          >
            {open ? (
              <KeyboardArrowUp fontSize="small" />
            ) : (
              <KeyboardArrowDown fontSize="small" />
            )}
          </button>
        </td>

        <td className="px-4 py-3">
          <div className="font-medium text-slate-900">{inv.tranId}</div>
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
          <span className={hasBalance ? "text-rose-600" : "text-emerald-600"}>
            {fmt(inv.amountRemaining)}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <Chip
              size="small"
              label={hasBalance ? "Open" : "Closed"}
              color={hasBalance ? "warning" : "success"}
              variant={hasBalance ? "outlined" : "filled"}
              sx={{ borderRadius: "10px" }}
            />
            {canPay && onPay && (
              <button
                onClick={() => onPay(inv)}
                className="inline-flex h-8 items-center gap-1 rounded-lg bg-blue-600 px-3 text-xs font-medium text-white shadow-sm hover:bg-blue-700"
              >
                <PaymentIcon fontSize="inherit" />
                Pay
              </button>
            )}
          </div>
        </td>
      </tr>

      <tr className="border-t border-slate-100">
        <td colSpan={7} className="p-0 align-top">
          <Collapse in={open} timeout="auto" unmountOnExit>
            <div
              id={panelId}
              className="bg-slate-50/40 px-3 pt-3 pb-4 md:px-4 border-t border-slate-100 overflow-x-auto"
            >
              <Details inv={inv} />
            </div>
          </Collapse>
        </td>
      </tr>
    </>
  );
}

/* ---------------------------------------------------------------------- */
/* Mobile list (cards)                                                     */
/* ---------------------------------------------------------------------- */

function MobileList({
  invoices,
  onPay,
  variant,
}: {
  invoices: Invoice[];
  onPay?: (inv: Invoice) => void;
  variant: "open" | "closed";
}) {
  if (invoices.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-slate-500">No invoices.</div>
    );
  }
  return (
    <div className="divide-y divide-slate-100">
      {invoices.map((inv) => (
        <MobileCard
          key={String(inv.invoiceId)}
          inv={inv}
          canPay={variant === "open" && inv.amountRemaining > 0}
          onPay={onPay}
        />
      ))}
    </div>
  );
}

function MobileCard({
  inv,
  canPay,
  onPay,
}: {
  inv: Invoice;
  canPay: boolean;
  onPay?: (inv: Invoice) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const hasBalance = inv.amountRemaining > 0;
  const panelId = `m-invoice-details-${inv.invoiceId}`;

  return (
    <div className="p-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-semibold text-slate-900">{inv.tranId}</div>
          <Chip
            size="small"
            label={hasBalance ? "Open" : "Closed"}
            color={hasBalance ? "warning" : "success"}
            variant={hasBalance ? "outlined" : "filled"}
            sx={{ borderRadius: "10px" }}
          />
        </div>

        <div className="mb-3 text-xs text-slate-500">
          Date: {fdate(inv.trandate)}
        </div>

        <div className="mb-3 grid grid-cols-3 gap-3">
          <Metric label="Total" value={fmt(inv.total)} />
          <Metric label="Paid" value={fmt(inv.amountPaid)} />
          <Metric
            label="Remaining"
            value={fmt(inv.amountRemaining)}
            valueClass={hasBalance ? "text-rose-600" : "text-emerald-600"}
          />
        </div>

        <div className="flex items-center justify-between">
          {canPay && onPay ? (
            <button
              onClick={() => onPay(inv)}
              className="inline-flex h-9 items-center gap-1 rounded-lg bg-blue-600 px-3 text-xs font-medium text-white shadow-sm hover:bg-blue-700"
            >
              <PaymentIcon fontSize="inherit" />
              Pay
            </button>
          ) : (
            <div />
          )}
          <button
            onClick={() => setOpen((s) => !s)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            aria-expanded={open}
            aria-controls={panelId}
          >
            {open ? (
              <>
                <KeyboardArrowUp fontSize="small" /> Hide details
              </>
            ) : (
              <>
                <KeyboardArrowDown fontSize="small" /> Show details
              </>
            )}
          </button>
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
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={`mt-0.5 text-sm font-semibold ${
          valueClass ?? "text-slate-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Shared details section                                                  */
/* ---------------------------------------------------------------------- */

function Details({ inv, mobile = false }: { inv: Invoice; mobile?: boolean }) {
  return (
    <>
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
        Details
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Line Items
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[560px] w-full table-auto text-sm">
              <thead className="text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(inv.lines ?? []).length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-6 text-center text-sm text-slate-500"
                      colSpan={4}
                    >
                      No line items.
                    </td>
                  </tr>
                ) : (
                  inv.lines.map((l, idx) => (
                    <tr key={idx} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-900 break-words">
                        {l.itemName ?? l.itemId ?? "—"}
                        {l.description ? (
                          <div className="text-xs text-slate-500">
                            {l.description}
                          </div>
                        ) : null}
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
        </div>

        {/* Related payments */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
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
                <tbody>
                  {inv.payments.map((p, i) => (
                    <tr key={i} className="border-t border-slate-100">
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
                      <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                        {fmt(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------- */
/* Skeletons                                                               */
/* ---------------------------------------------------------------------- */

function SkeletonTable() {
  return (
    <table className="w-full table-fixed text-sm">
      <colgroup>
        <col className="w-[44px]" />
        <col className="w-[22%]" />
        <col className="w-[14%]" />
        <col className="w-[14%]" />
        <col className="w-[14%]" />
        <col className="w-[16%]" />
        <col className="w-[16%]" />
      </colgroup>
      <thead className="sticky top-0 z-10 bg-gradient-to-b from-slate-50 to-white">
        <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
          <th className="px-3 py-3"> </th>
          <th className="px-4 py-3">Invoice</th>
          <th className="px-4 py-3">Date</th>
          <th className="px-4 py-3 text-right">Total</th>
          <th className="px-4 py-3 text-right">Paid</th>
          <th className="px-4 py-3 text-right">Remaining</th>
          <th className="px-4 py-3">Status</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: 5 }).map((_, i) => (
          <tr key={i} className="border-t border-slate-100">
            <td className="px-3 py-3">
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white">
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
              <Skeleton width={90} height={26} />
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
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="p-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
              <Skeleton width={80} height={36} />
              <Skeleton width={110} height={28} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
