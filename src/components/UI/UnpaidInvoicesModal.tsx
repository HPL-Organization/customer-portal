// components/UI/UnpaidInvoicesModal.tsx
"use client";

import { AnimatePresence, motion } from "framer-motion";
import React from "react";

type Props = {
  open: boolean;
  graceDays: number | null;
  onGoToInvoices: () => void;
  onEnterEvent: () => void | Promise<void>;
  onClose?: () => void;
};

export default function UnpaidInvoicesModal({
  open,
  graceDays,
  onGoToInvoices,
  onEnterEvent,
  onClose,
}: Props) {
  const daysLabel =
    graceDays == null
      ? "the grace period"
      : `${graceDays} day${graceDays === 1 ? "" : "s"}`;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-[3px]"
            onClick={onClose}
          />

          <div className="relative z-10 flex min-h-full items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.985 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_30px_80px_rgba(0,0,0,0.22)]"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Unpaid invoices detected"
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(90%_120%_at_30%_0%,rgba(224,28,36,0.10),transparent_60%),radial-gradient(70%_100%_at_85%_0%,rgba(140,15,15,0.08),transparent_55%),linear-gradient(180deg,rgba(255,255,255,0.95),rgba(255,255,255,0))]" />

              <div className="relative p-6 sm:p-7">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs font-medium text-[#17152A]/80">
                      Billing notice
                      <span className="h-1 w-1 rounded-full bg-[#E01C24]" />
                      Live event
                    </div>

                    <h3 className="mt-2 text-[18px] font-semibold leading-snug tracking-[-0.01em] text-[#17152A]">
                      Unpaid invoices detected
                    </h3>
                  </div>

                  <button
                    type="button"
                    aria-label="Close"
                    onClick={onClose}
                    className="rounded-xl p-2 text-[#17152A]/55 transition hover:bg-black/5 hover:text-[#17152A]/80 active:bg-black/10"
                  >
                    <span className="text-lg leading-none">×</span>
                  </button>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-[#17152A]/70">
                  You have unpaid{" "}
                  <span className="font-semibold text-[#17152A]">
                    live event
                  </span>{" "}
                  invoices older than{" "}
                  <span className="font-semibold text-[#17152A]">
                    {daysLabel}
                  </span>
                  .
                  <span className="mt-1 block">
                    You can still enter, but{" "}
                    <span className="font-semibold text-[#17152A]">
                      your bids will be ignored
                    </span>
                    .
                  </span>
                </p>

                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    className="rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-medium text-[#17152A] shadow-sm transition hover:bg-black/[0.03] active:bg-black/[0.06]"
                    onClick={onGoToInvoices}
                  >
                    View invoices
                  </button>

                  <button
                    type="button"
                    className="rounded-xl bg-gradient-to-r from-[#8C0F0F] to-[#E01C24] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_26px_rgba(224,28,36,0.22)] transition hover:brightness-[1.03] active:brightness-[0.98]"
                    onClick={() => onEnterEvent()}
                  >
                    Enter event anyway
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}
