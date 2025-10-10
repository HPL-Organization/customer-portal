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

function fmtDate(input: string) {
  const d = new Date(input);
  if (isNaN(d.getTime())) return input;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function classNames(...xs: Array<string | false | null | undefined>) {
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

const tone: Record<string, string> = {
  Shipped: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Pending: "bg-amber-100 text-amber-800 border-amber-200",
  Partially: "bg-blue-100 text-blue-800 border-blue-200",
  Cancelled: "bg-rose-100 text-rose-700 border-rose-200",
};

function StatusBadge({ label }: { label: string }) {
  const key = Object.keys(tone).find((k) => label?.startsWith(k));
  const cls = key ? tone[key] : "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span
      className={classNames(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        cls
      )}
    >
      {label || "—"}
    </span>
  );
}

export default function OrderTrackingPage() {
  const { loading, error, fulfillments, refresh } = useOrderTracking();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!q.trim()) return fulfillments;
    const needle = q.toLowerCase();
    return fulfillments.filter((ff) => {
      const inHeader =
        (ff.orderNumber || "").toLowerCase().includes(needle) ||
        String(ff.number || "")
          .toLowerCase()
          .includes(needle) ||
        String(ff.status || "")
          .toLowerCase()
          .includes(needle) ||
        String(ff.shipStatus || "")
          .toLowerCase()
          .includes(needle) ||
        fmtDate(String(ff.shippedAt || ""))
          .toLowerCase()
          .includes(needle);
      if (inHeader) return true;
      return (ff.items || []).some(
        (it: any) =>
          String(it.sku || "")
            .toLowerCase()
            .includes(needle) ||
          String(it.productName || "")
            .toLowerCase()
            .includes(needle) ||
          String(it.quantity || "").includes(needle) ||
          String(it.tracking || "")
            .toLowerCase()
            .includes(needle)
      );
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
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Order Tracking
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            View shipments and tracking numbers linked to your account.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by IF #, Product, tracking, status…"
              className="w-72 rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none ring-0 transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
            />
          </div>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

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
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-md font-semibold text-slate-900">
                          {ff.orderNumber}
                        </span>
                        <span className="text-sm  text-slate-900">
                          {ff.fulfillmentNumber}
                        </span>
                        <span className="text-sm text-slate-500">•</span>
                        <span className="text-sm text-slate-600">
                          {fmtDate(ff.shippedAt)}
                        </span>
                        {statusPills.map((s) => (
                          <StatusBadge key={s} label={s} />
                        ))}
                      </div>

                      <div className="mt-3 flex flex-col gap-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {trackLabel}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {tracks.map((t) => (
                            <span
                              key={t}
                              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-mono font-semibold text-white shadow-sm"
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
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200">
                      <thead className="bg-slate-50">
                        <tr>
                          <Th>SKU</Th>
                          <Th>Product</Th>
                          <Th className="text-right">Qty</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {(ff.items || []).map((it: any, idx: number) => (
                          <tr
                            key={`${ff.id}-${it.sku}-${idx}`}
                            className="hover:bg-slate-50"
                          >
                            <Td>
                              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-700">
                                {it.sku}
                              </code>
                            </Td>
                            <Td>
                              <div
                                className="max-w-[48ch] truncate text-sm text-slate-800"
                                title={it.productName}
                              >
                                {it.productName}
                              </div>
                            </Td>
                            <Td className="text-right font-semibold text-slate-900">
                              {it.quantity}
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {loading && fulfillments.length > 0 && (
        <div className="fixed top-20 left-1/2 z-[60] -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-sm font-medium text-slate-800 shadow-lg">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
            Refreshing shipments…
          </div>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={classNames(
        "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600",
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
      className={classNames(
        "px-4 py-3 align-top text-sm text-slate-700",
        className
      )}
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
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-700">
          {icon}
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {title}
          </div>
          <div className="text-lg font-semibold text-slate-900">{value}</div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-16 grid place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
      <Truck className="mb-2 h-8 w-8 text-slate-400" />
      <h3 className="text-base font-semibold text-slate-800">
        No shipments yet
      </h3>
      <p className="mt-1 max-w-md text-sm text-slate-600">
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
    <div className="mt-8 flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 p-4">
      <div className="flex items-center gap-3 text-rose-700">
        <CircleAlert className="h-5 w-5" />
        <div>
          <div className="text-sm font-semibold">Couldn't load shipments</div>
          <div className="text-sm opacity-90">{message}</div>
        </div>
      </div>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-700 shadow-sm transition hover:bg-rose-50"
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
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="h-4 w-1/3 rounded bg-slate-200" />
            <div className="mt-4 h-28 rounded-xl border border-slate-200 bg-slate-50" />
          </div>
        </li>
      ))}
    </ul>
  );
}
