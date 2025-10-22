"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Truck, CircleAlert, Copy } from "lucide-react";
import { useOrderTracking } from "@/components/providers/OrderTrackingProvider";

type FulfillmentLine = {
  sku?: string;
  productName?: string;
  quantity?: number;
  comments?: string[];
  tracking?: string;
};
type Fulfillment = {
  id?: string | number;
  orderNumber?: string;
  fulfillmentNumber?: string;
  status?: string;
  shipStatus?: string;
  shippedAt?: string;
  items?: FulfillmentLine[];
  tracking?: string | null;
  tracking_urls?: string[] | null;
};

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}
function unique<T>(arr: T[]) {
  return Array.from(new Set(arr));
}
function fmtDate(input?: string) {
  if (!input) return "—";
  const d = new Date(input);
  return isNaN(d.getTime())
    ? String(input)
    : d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}
function tone(label: string) {
  if (label?.startsWith("Shipped"))
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (label?.startsWith("Picked"))
    return "bg-[#FFFFEC] text-[#17152A] border-[#BFBFBF]";
  if (label?.startsWith("Pending"))
    return "bg-[#FFFFEC] text-[#17152A] border-[#BFBFBF]";
  if (label?.startsWith("Partially"))
    return "bg-blue-50 text-blue-800 border-blue-200";
  if (label?.startsWith("Cancelled"))
    return "bg-rose-50 text-rose-700 border-rose-200";
  return "bg-slate-50 text-[#17152A] border-[#BFBFBF]";
}
async function copy(t: string) {
  try {
    await navigator.clipboard.writeText(t);
  } catch {}
}
function getTrackingNumbers(ff: Fulfillment): string[] {
  const fromItems =
    (ff.items || [])
      .map((it) => String(it.tracking || "").trim())
      .filter(Boolean) || [];
  const rootOne = ff.tracking ? [String(ff.tracking).trim()] : [];
  const rootMany = Array.isArray(ff.tracking_urls)
    ? (ff.tracking_urls as string[])
        .map((u) => String(u || "").trim())
        .filter(Boolean)
    : [];
  return unique([...fromItems, ...rootOne, ...rootMany]);
}
function getPrimaryStatus(ff: Fulfillment): string {
  return (ff.shipStatus || ff.status || "").trim();
}

export default function FulfillmentPeek({
  soId,
}: {
  soId: number | string | null | undefined;
}) {
  const { loading, error, fulfillments } = useOrderTracking();

  const list = React.useMemo<Fulfillment[]>(() => {
    if (soId == null || soId === "" || Number.isNaN(Number(soId))) return [];
    const target = String(soId);
    return fulfillments
      .filter((f) => String((f as any).salesOrderId || "") === target)
      .map((f) => ({
        id: (f as any).id,
        orderNumber:
          (f as any).orderNumber || (f as any).salesOrderTranId || undefined,
        fulfillmentNumber: (f as any).fulfillmentNumber,
        status: (f as any).status,
        shipStatus: (f as any).shipStatus,
        shippedAt: (f as any).shippedAt,
        items: ((f as any).items || []).map((it: any) => ({
          sku: it.sku,
          productName: it.productName,
          quantity: it.quantity,
          comments: it.comments,
          tracking: it.tracking,
        })),
        tracking: (f as any).tracking || null,
        tracking_urls: (f as any).trackingUrls || [],
      }));
  }, [fulfillments, soId]);

  const empty = !loading && !error && list.length === 0;
  const allTracks = unique(list.flatMap((ff) => getTrackingNumbers(ff)));
  const topStatus = getPrimaryStatus(list[0] || {});

  return (
    <div className="rounded-2xl border border-[#BFBFBF]/60 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-[#8C0F0F]/10 text-[#8C0F0F]">
            <Truck className="h-4 w-4" />
          </div>
          <div className="text-sm font-semibold text-[#17152A]">
            Fulfillment
          </div>
          {topStatus ? (
            <span
              className={cx(
                "ml-2 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                tone(topStatus)
              )}
            >
              {topStatus}
            </span>
          ) : null}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[#17152A]/70">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#BFBFBF] border-t-[#17152A]" />
            Loading…
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 rounded-xl border border-[#BFBFBF] bg-[#FFFFEC] px-3 py-1.5 text-sm text-[#17152A]">
            <CircleAlert className="h-4 w-4 text-[#8C0F0F]" />
            Error
          </div>
        ) : empty || allTracks.length === 0 ? (
          <span className="shrink-0 inline-flex items-center rounded-full border border-[#BFBFBF] bg-[#FFFFEC] px-3 py-1.5 text-[11px] font-semibold text-[#17152A]">
            <span className="sm:hidden">No tracking yet</span>
            <span className="hidden sm:inline">No tracking number yet</span>
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {allTracks.slice(0, 3).map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-2 rounded-full bg-[#8C0F0F] px-3 py-1.5 text-[11px] font-mono font-semibold text-white shadow-sm"
                title={t}
              >
                <span className="truncate max-w-[22ch]">{t}</span>
                <button
                  onClick={() => copy(t)}
                  className="rounded bg-white/10 p-0.5 hover:bg-white/20"
                  aria-label="Copy tracking number"
                  title="Copy tracking number"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {allTracks.length > 3 ? (
              <span className="rounded-full border border-[#BFBFBF] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#17152A]">
                +{allTracks.length - 3} more
              </span>
            ) : null}
          </div>
        )}
      </div>

      {!soId ? (
        <div className="rounded-xl border border-dashed border-[#BFBFBF] bg-[#FFFFEC] p-3 text-sm text-[#17152A]">
          This invoice isn’t linked to a sales order yet.
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-xl border border-[#BFBFBF] bg-[#FFFFEC] px-3 py-2 text-sm text-[#17152A]">
          <CircleAlert className="h-4 w-4 text-[#8C0F0F]" />
          {error}
        </div>
      ) : empty ? (
        <div className="rounded-xl border border-dashed border-[#BFBFBF] bg-[#FFFFEC] p-3 text-sm text-[#17152A]">
          We didn’t find a shipment tied to this order yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((ff, i) => (
            <li key={String(ff.id ?? i)}>
              <motion.div
                whileHover={{ y: -1 }}
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
                className="rounded-xl bg-white p-3 ring-1 ring-[#BFBFBF]/60"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-extrabold tracking-tight text-[#17152A]">
                      {ff.orderNumber || "Order"}
                    </span>
                    <span className="text-sm font-medium text-[#17152A]/80">
                      {ff.fulfillmentNumber || ""}
                    </span>
                    <span className="hidden sm:inline text-sm text-[#17152A]/45">
                      •
                    </span>
                    <span className="text-sm text-[#17152A]/70">
                      {fmtDate(ff.shippedAt)}
                    </span>
                  </div>
                </div>

                <AnimatePresence>
                  {(ff.items || []).length > 0 && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
                      className="mt-3 overflow-x-auto"
                    >
                      <table className="min-w-[520px] w-full text-sm">
                        <thead className="bg-[#FFFFEC]">
                          <tr className="text-[#17152A]/75">
                            <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide">
                              SKU
                            </th>
                            <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide">
                              Product
                            </th>
                            <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide">
                              Qty
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white">
                          {(ff.items || []).slice(0, 6).map((it, idx) => (
                            <tr
                              key={`${it.sku}-${idx}`}
                              className={cx(
                                idx % 2 === 0 ? "bg-white" : "bg-black/[0.02]"
                              )}
                            >
                              <td className="px-3 py-2 text-[#17152A]/90">
                                <code className="rounded bg-black/[0.06] px-1.5 py-0.5 text-[12px]">
                                  {it.sku || "—"}
                                </code>
                              </td>
                              <td className="px-3 py-2 text-[#17152A]/90">
                                <div
                                  className="max-w-[52ch] truncate"
                                  title={it.productName}
                                >
                                  {it.productName || "—"}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right font-semibold text-[#17152A] whitespace-nowrap">
                                {it.quantity ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
