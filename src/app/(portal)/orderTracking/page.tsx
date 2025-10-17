"use client";

import React, { useMemo, useState, useCallback } from "react";
import {
  PackageCheck,
  Truck,
  RefreshCw,
  Search,
  Copy,
  CircleAlert,
} from "lucide-react";
import { useOrderTracking } from "@/components/providers/OrderTrackingProvider";

/* ---------- utils ---------- */
function fmtDate(input: string) {
  const d = new Date(input);
  if (isNaN(d.getTime())) return input;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}
function unique<T>(arr: T[]) {
  return Array.from(new Set(arr));
}
function extractFulfillmentTracking(ff: {
  items?: Array<{ tracking?: string }>;
}): string[] {
  const all = unique(
    (ff.items || []).map((it) => (it.tracking || "").trim()).filter(Boolean)
  );
  return all.length ? all : ["—"];
}

/* Brand-tinted status pills */
const tone: Record<string, string> = {
  Shipped: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Picked: "bg-[#FFFFEC] text-[#17152A] border-[#BFBFBF]",
  Pending: "bg-[#FFFFEC] text-[#17152A] border-[#BFBFBF]",
  Partially: "bg-blue-50 text-blue-800 border-blue-200",
  Cancelled: "bg-rose-50 text-rose-700 border-rose-200",
};

function StatusBadge({ label }: { label: string }) {
  const key = Object.keys(tone).find((k) => label?.startsWith(k));
  const cls = key ? tone[key] : "bg-slate-50 text-[#17152A] border-[#BFBFBF]";
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        cls
      )}
    >
      {label || "—"}
    </span>
  );
}

/* ---------- page ---------- */
export default function OrderTrackingPage() {
  const { loading, error, fulfillments, refresh } = useOrderTracking();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!q.trim()) return fulfillments;
    const needle = q.toLowerCase();
    const inStr = (s: any) =>
      String(s ?? "")
        .toLowerCase()
        .includes(needle);

    return fulfillments.filter((ff) => {
      if (
        inStr(ff.orderNumber) ||
        inStr(ff.number) ||
        inStr(ff.status) ||
        inStr(ff.shipStatus) ||
        inStr(fmtDate(String(ff.shippedAt || "")))
      ) {
        return true;
      }

      return (ff.items || []).some((it: any) => {
        const matchesComments =
          Array.isArray(it.comments) &&
          it.comments.some((c: string) => inStr(c));

        return (
          inStr(it.sku) ||
          inStr(it.productName) ||
          String(it.quantity ?? "").includes(needle) ||
          inStr(it.tracking) ||
          matchesComments
        );
      });
    });
  }, [q, fulfillments]);

  const totals = useMemo(() => {
    const totalFF = filtered.length;
    const totalQty = filtered.reduce(
      (acc, ff: any) =>
        acc +
        (ff.items || []).reduce(
          (a: number, it: any) => a + (Number(it.quantity) || 0),
          0
        ),
      0
    );
    return { totalFF, totalQty };
  }, [filtered]);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      const t = document.createElement("div");
      t.textContent = "Copied";
      t.className =
        "fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/80 px-3 py-1 text-xs text-white";
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 900);
    } catch {}
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#17152A]">
            Order Tracking
          </h1>

          <div className="mt-2 h-[3px] w-24 rounded-full bg-gradient-to-r from-[#8C0F0F] to-[#E01C24]" />
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#17152A]/40" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search IF #, product, tracking, status…"
              className="w-80 rounded-xl border border-[#BFBFBF] bg-white py-2 pl-9 pr-3 text-sm text-[#17152A] outline-none shadow-sm placeholder:text-[#17152A]/45 focus:ring-2 focus:ring-[#8C0F0F]/25"
            />
          </div>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#BFBFBF] bg-white px-3 py-2 text-sm font-semibold text-[#17152A] shadow-sm transition hover:bg-[#FFFFEC] focus-visible:ring-2 focus-visible:ring-[#8C0F0F]/25"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <StatCard
          title="Shipments"
          value={totals.totalFF.toLocaleString()}
          icon={<Truck className="h-5 w-5" />}
        />
        <StatCard
          title="Units Shipped"
          value={totals.totalQty.toLocaleString()}
          icon={<PackageCheck className="h-5 w-5" />}
        />
      </div>

      {/* Content */}
      {error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : loading && fulfillments.length === 0 ? (
        <SkeletonList />
      ) : fulfillments.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-4">
          {filtered.map((ff: any) => {
            const statusPills = unique(
              [ff.shipStatus, ff.status]
                .map((s) => (s || "").trim())
                .filter(Boolean)
            );
            const tracks = extractFulfillmentTracking(ff);
            const trackLabel =
              tracks.length > 1 ? "Tracking Numbers" : "Tracking Number";

            return (
              <li key={ff.id}>
                <div className="rounded-2xl border border-[#BFBFBF]/60 bg-white p-0 shadow-sm">
                  {/* Card header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#BFBFBF]/60 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-extrabold tracking-tight text-[#17152A]">
                        {ff.orderNumber}
                      </span>
                      <span className="text-sm font-medium text-[#17152A]/80">
                        {ff.fulfillmentNumber}
                      </span>
                      <span className="text-sm text-[#17152A]/45">•</span>
                      <span className="text-sm text-[#17152A]/70">
                        {fmtDate(ff.shippedAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {statusPills.map((s) => (
                        <StatusBadge key={s} label={s} />
                      ))}
                    </div>
                  </div>

                  {/* Tracking */}
                  <div className="px-5 pb-5 pt-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[#17152A]/60">
                      {trackLabel}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {tracks.map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#8C0F0F] px-3 py-1.5 text-sm font-mono font-semibold text-white shadow-sm"
                        >
                          {t}
                          {t !== "—" && (
                            <button
                              onClick={() => copy(t)}
                              className="rounded bg-white/10 p-0.5 hover:bg-white/20"
                              aria-label="Copy tracking number"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>

                    {/* Items */}
                    <div className="mt-4 overflow-hidden rounded-xl border border-[#BFBFBF]/60">
                      <table className="min-w-full divide-y divide-[#BFBFBF]/60">
                        <thead className="bg-[#FFFFEC]">
                          <tr>
                            <Th>SKU</Th>
                            <Th>Product</Th>
                            <Th>Comments</Th> {/* NEW */}
                            <Th className="text-right">Qty</Th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {(ff.items || []).map((it: any, idx: number) => (
                            <tr
                              key={`${ff.id}-${it.sku}-${idx}`}
                              className="hover:bg-black/[0.02]"
                            >
                              <Td>
                                <code className="rounded bg-black/[0.06] px-1.5 py-0.5 text-[12px] text-[#17152A]">
                                  {it.sku}
                                </code>
                              </Td>

                              <Td>
                                <div
                                  className="max-w-[52ch] truncate text-sm text-[#17152A]"
                                  title={it.productName}
                                >
                                  {it.productName}
                                </div>
                              </Td>

                              <Td>
                                {Array.isArray(it.comments) &&
                                it.comments.length > 0 ? (
                                  <div className="flex max-w-[60ch] flex-wrap gap-1.5">
                                    {it.comments.map((c: string, i: number) => (
                                      <span
                                        key={`${it.sku}-c-${i}`}
                                        title={c}
                                        className="truncate rounded-md border border-[#BFBFBF]/60 bg-[#FFFFEC] px-1.5 py-0.5 text-[12px] text-[#17152A] max-w-[28ch]"
                                      >
                                        {c}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-[#17152A]/50">—</span>
                                )}
                              </Td>

                              <Td className="text-right font-semibold text-[#17152A]">
                                {it.quantity}
                              </Td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* mini toast while background refresh adds more rows */}
      {loading && fulfillments.length > 0 && (
        <div className="fixed top-20 left-1/2 z-[60] -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-[#BFBFBF] bg-white/95 px-4 py-2 text-sm font-medium text-[#17152A] shadow-lg">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#BFBFBF] border-t-[#17152A]" />
            Refreshing shipments…
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- subcomponents ---------- */
function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cx(
        "px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-[#17152A]/75",
        className
      )}
    >
      {children}
    </th>
  );
}
function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td
      className={cx("px-4 py-3 align-top text-sm text-[#17152A]/90", className)}
    >
      {children}
    </td>
  );
}
function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[#BFBFBF]/60 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#8C0F0F]/10 text-[#8C0F0F]">
          {icon}
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#17152A]/60">
            {title}
          </div>
          <div className="text-lg font-semibold text-[#17152A]">{value}</div>
        </div>
      </div>
    </div>
  );
}
function EmptyState() {
  return (
    <div className="mt-16 grid place-items-center rounded-2xl border border-dashed border-[#BFBFBF] bg-[#FFFFEC] p-10 text-center">
      <Truck className="mb-2 h-8 w-8 text-[#17152A]/50" />
      <h3 className="text-base font-semibold text-[#17152A]">
        No shipments yet
      </h3>
      <p className="mt-1 max-w-md text-sm text-[#17152A]/70">
        We couldn't find any item fulfillments. Try adjusting your search or
        come back later.
      </p>
    </div>
  );
}
function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="mt-8 flex items-center justify-between rounded-2xl border border-[#BFBFBF] bg-[#FFFFEC] p-4">
      <div className="flex items-center gap-3 text-[#17152A]">
        <CircleAlert className="h-5 w-5 text-[#8C0F0F]" />
        <div>
          <div className="text-sm font-semibold">Couldn't load shipments</div>
          <div className="text-sm opacity-80">{message}</div>
        </div>
      </div>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-xl border border-[#BFBFBF] bg-white px-3 py-2 text-sm font-semibold text-[#17152A] shadow-sm transition hover:bg-[#FFFFEC] focus-visible:ring-2 focus-visible:ring-[#8C0F0F]/25"
      >
        <RefreshCw className="h-4 w-4" /> Try again
      </button>
    </div>
  );
}
function SkeletonList() {
  return (
    <ul className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i} className="animate-pulse">
          <div className="rounded-2xl border border-[#BFBFBF]/60 bg-white p-5 shadow-sm">
            <div className="h-4 w-1/3 rounded bg-black/[0.06]" />
            <div className="mt-4 h-28 rounded-xl border border-[#BFBFBF]/60 bg-black/[0.03]" />
          </div>
        </li>
      ))}
    </ul>
  );
}
