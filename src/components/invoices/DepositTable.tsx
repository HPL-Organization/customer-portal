"use client";

import * as React from "react";
import { Chip, Skeleton } from "@mui/material";
import type { Deposit } from "@/lib/types/billing";

function fmt(n: number | undefined) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(Number(n ?? 0));
}
function fdate(d?: string | null) {
  return d ? new Date(d).toLocaleDateString() : "—";
}

export default function DepositsTable({
  loading,
  deposits,
}: {
  loading: boolean;
  deposits: Deposit[];
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Desktop / Tablet */}
      <div className="hidden md:block">
        {loading ? <DesktopSkeleton /> : <DesktopGrid deposits={deposits} />}
      </div>

      {/* Mobile */}
      <div className="md:hidden">
        {loading ? <MobileSkeleton /> : <MobileList deposits={deposits} />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Desktop                                                                 */
/* ---------------------------------------------------------------------- */

function DesktopGrid({ deposits }: { deposits: Deposit[] }) {
  return (
    <div className="overflow-x-auto">
      {/* Give inner content a min width to avoid chip overflow jitter */}
      <div className="min-w-[880px]">
        {/* Header */}
        <div className="sticky top-0 grid grid-cols-[minmax(160px,1.1fr)_minmax(120px,.9fr)_minmax(140px,1fr)_minmax(320px,1.6fr)_minmax(220px,1.2fr)] items-center gap-3 border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
          <div>Deposit</div>
          <div>Date</div>
          <div className="text-right">Amount</div>
          <div>Status</div>
          <div>Applied</div>
        </div>

        {deposits.length === 0 ? (
          <div className="px-4 py-10 text-center text-slate-500">
            No deposits.
          </div>
        ) : (
          deposits.map((d) => (
            <div
              key={String(d.depositId)}
              className="grid grid-cols-[minmax(160px,1.1fr)_minmax(120px,.9fr)_minmax(140px,1fr)_minmax(320px,1.6fr)_minmax(220px,1.2fr)] items-center gap-3 border-b border-slate-100 px-4 py-3 hover:bg-slate-50/70"
            >
              <div className="font-medium text-slate-900 truncate">
                {d.tranId}
              </div>

              <div className="text-slate-600 whitespace-nowrap">
                {fdate(d.trandate as any)}
              </div>

              <div className="text-right font-medium text-slate-900 whitespace-nowrap">
                {fmt(d.total)}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {d.isFullyApplied && (
                  <Chip
                    size="small"
                    color="success"
                    variant="filled"
                    label="Fully Applied"
                    sx={{ borderRadius: "10px" }}
                  />
                )}
                {d.isPartiallyApplied && (
                  <Chip
                    size="small"
                    color="warning"
                    variant="outlined"
                    label="Partially Applied"
                    sx={{ borderRadius: "10px" }}
                  />
                )}
                {d.isUnapplied && (
                  <Chip
                    size="small"
                    color="default"
                    variant="outlined"
                    label="Unapplied"
                    sx={{ borderRadius: "10px" }}
                  />
                )}
                {d.isAppliedToSO && (
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label="Applied to SO"
                    sx={{ borderRadius: "10px" }}
                  />
                )}
              </div>

              <div className="text-sm text-slate-700 truncate">
                {d.appliedTo?.soTranId ? d.appliedTo.soTranId : "—"}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Mobile                                                                  */
/* ---------------------------------------------------------------------- */

function MobileList({ deposits }: { deposits: Deposit[] }) {
  if (deposits.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-slate-500">No deposits.</div>
    );
  }

  return (
    <div className="divide-y divide-slate-100">
      {deposits.map((d) => {
        const chips = (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {d.isFullyApplied && (
              <Chip
                size="small"
                color="success"
                variant="filled"
                label="Fully Applied"
                sx={{ borderRadius: "10px" }}
              />
            )}
            {d.isPartiallyApplied && (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label="Partially Applied"
                sx={{ borderRadius: "10px" }}
              />
            )}
            {d.isUnapplied && (
              <Chip
                size="small"
                color="default"
                variant="outlined"
                label="Unapplied"
                sx={{ borderRadius: "10px" }}
              />
            )}
            {d.isAppliedToSO && (
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label="Applied to SO"
                sx={{ borderRadius: "10px" }}
              />
            )}
          </div>
        );

        return (
          <div key={String(d.depositId)} className="p-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate">
                    {d.tranId}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    Date: {fdate(d.trandate as any)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Amount
                  </div>
                  <div className="text-sm font-semibold text-slate-900">
                    {fmt(d.total)}
                  </div>
                </div>
              </div>

              {chips}

              <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Applied
                </div>
                <div className="mt-1 text-slate-800">
                  {d.appliedTo?.soTranId ? d.appliedTo.soTranId : "—"}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Skeletons                                                               */
/* ---------------------------------------------------------------------- */

function DesktopSkeleton() {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[880px]">
        <div className="sticky top-0 grid grid-cols-[minmax(160px,1.1fr)_minmax(120px,.9fr)_minmax(140px,1fr)_minmax(320px,1.6fr)_minmax(220px,1.2fr)] items-center gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
          <div>Deposit</div>
          <div>Date</div>
          <div className="text-right">Amount</div>
          <div>Status</div>
          <div>Applied</div>
        </div>

        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-[minmax(160px,1.1fr)_minmax(120px,.9fr)_minmax(140px,1fr)_minmax(320px,1.6fr)_minmax(220px,1.2fr)] items-center gap-3 border-b border-slate-100 px-4 py-3"
          >
            <Skeleton variant="text" width={120} />
            <Skeleton variant="text" width={90} />
            <Skeleton variant="text" width={80} />
            <div className="flex gap-1.5">
              <Skeleton variant="rounded" width={100} height={24} />
              <Skeleton variant="rounded" width={120} height={24} />
            </div>
            <Skeleton variant="text" width={160} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileSkeleton() {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="p-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <Skeleton width={120} />
              <div className="text-right">
                <Skeleton width={80} />
                <Skeleton width={70} />
              </div>
            </div>
            <div className="mt-2 flex gap-1.5">
              <Skeleton variant="rounded" width={100} height={24} />
              <Skeleton variant="rounded" width={120} height={24} />
            </div>
            <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
              <Skeleton width={60} />
              <Skeleton width={140} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
