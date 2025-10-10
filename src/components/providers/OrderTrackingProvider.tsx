// src/components/providers/OrderTrackingProvider.tsx
"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useCustomerBootstrap } from "./CustomerBootstrap";

export type TrackingDetail = {
  number: string;
  carrier: string;
  url: string;
};

export type FulfillmentItem = {
  sku: string;
  productName: string;
  quantity: number;
  serialNumbers: string[];
  tracking: string;
};

export type Fulfillment = {
  id: number | string;
  number: string; // e.g., "SO-521210 • IF-556"
  orderNumber: string | null; // e.g., "SO-521210"
  fulfillmentNumber: string; // e.g., "IF-556"
  shippedAt: string;
  shipStatus: string;
  status: string;
  tracking: string; // comma-separated
  trackingUrls: string[];
  trackingDetails: TrackingDetail[];
  salesOrderId: number | string | null;
  salesOrderTranId: string | null;
  items: FulfillmentItem[];
};

export type OrderTrackingState = {
  loading: boolean;
  error?: string | null;
  customerId: string | null;
  fulfillments: Fulfillment[];
  lastLoadedAt?: number | null;

  bySalesOrder: Record<string, Fulfillment[]>;
  trackingByOrder: Record<
    string,
    { numbers: string[]; urls: string[]; details: TrackingDetail[] }
  >;

  refresh: () => Promise<void>;
  setFulfillments: React.Dispatch<React.SetStateAction<Fulfillment[]>>;
};

const Ctx = createContext<OrderTrackingState | undefined>(undefined);

function normalizeFulfillment(raw: any): Fulfillment {
  const id = raw?.id ?? raw?.internalId ?? raw?.fulfillmentId ?? raw?.ID ?? "";
  const orderNumber =
    raw?.orderNumber != null
      ? String(raw.orderNumber)
      : raw?.salesOrderTranId != null
      ? String(raw.salesOrderTranId)
      : raw?.salesOrderNumber != null
      ? String(raw.salesOrderNumber)
      : null;

  const items: FulfillmentItem[] = Array.isArray(raw?.items)
    ? raw.items.map((x: any) => ({
        sku: String(x?.sku ?? x?.itemsku ?? x?.itemId ?? ""),
        productName: String(
          x?.productName ?? x?.itemdisplayname ?? x?.name ?? ""
        ),
        quantity: Number(x?.quantity ?? 0),
        serialNumbers: Array.isArray(x?.serialNumbers)
          ? x.serialNumbers.map((s: any) => String(s))
          : [],
        tracking: String(x?.tracking ?? raw?.tracking ?? ""),
      }))
    : [];

  return {
    id: String(id),
    number: String(raw?.number ?? raw?.tranId ?? raw?.tranid ?? ""),
    orderNumber,
    fulfillmentNumber: String(
      raw?.fulfillmentNumber ?? raw?.tranid ?? raw?.fulfillment ?? ""
    ),
    shippedAt: String(raw?.shippedAt ?? raw?.trandate ?? raw?.date ?? ""),
    shipStatus: String(raw?.shipStatus ?? ""),
    status: String(raw?.status ?? ""),
    tracking: String(raw?.tracking ?? ""),
    trackingUrls: Array.isArray(raw?.trackingUrls)
      ? raw.trackingUrls.map((u: any) => String(u))
      : [],
    trackingDetails: Array.isArray(raw?.trackingDetails)
      ? raw.trackingDetails.map((d: any) => ({
          number: String(d?.number ?? ""),
          carrier: String(d?.carrier ?? ""),
          url: String(d?.url ?? ""),
        }))
      : [],
    salesOrderId:
      raw?.salesOrderId != null
        ? String(raw.salesOrderId)
        : raw?.createdFromId != null
        ? String(raw.createdFromId)
        : null,
    salesOrderTranId:
      raw?.salesOrderTranId != null ? String(raw.salesOrderTranId) : null,
    items,
  };
}

export default function OrderTrackingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { nsId, initialized } = useCustomerBootstrap();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fulfillments, setFulfillments] = useState<Fulfillment[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);

  const fetchTracking = async (signal?: AbortSignal) => {
    if (!nsId) {
      setFulfillments([]);
      setCustomerId(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/netsuite/fulfillments?customerId=${encodeURIComponent(nsId)}`,
        { cache: "no-store", signal }
      );
      const text = await r.text();
      const data = text ? JSON.parse(text) : {};
      if (!r.ok) {
        throw new Error(
          data?.error || `Failed to load fulfillments (${r.status})`
        );
      }
      const rows = Array.isArray(data?.fulfillments) ? data.fulfillments : [];
      const list = rows.map(normalizeFulfillment);
      setFulfillments(list);
      setCustomerId(String(nsId));
      setLastLoadedAt(Date.now());
    } catch (e: any) {
      if (e?.name !== "AbortError")
        setError(e?.message || "Failed to load fulfillments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const ac = new AbortController();
    if (initialized) void fetchTracking(ac.signal);
    return () => ac.abort();
  }, [initialized, nsId]);

  const refresh = async () => {
    const ac = new AbortController();
    await fetchTracking(ac.signal);
    ac.abort();
  };

  const bySalesOrder = useMemo(() => {
    const map: Record<string, Fulfillment[]> = {};
    for (const f of fulfillments) {
      const key = (f.orderNumber || "").trim();
      if (!map[key]) map[key] = [];
      map[key].push(f);
    }
    return map;
  }, [fulfillments]);

  const trackingByOrder = useMemo(() => {
    const out: Record<
      string,
      { numbers: string[]; urls: string[]; details: TrackingDetail[] }
    > = {};
    for (const [order, list] of Object.entries(bySalesOrder)) {
      const nums = new Set<string>();
      const urls = new Set<string>();
      const detailsKey = new Set<string>();
      const details: TrackingDetail[] = [];
      for (const f of list) {
        for (const d of f.trackingDetails) {
          const k = `${d.number}::${d.carrier}::${d.url}`;
          if (!detailsKey.has(k)) {
            detailsKey.add(k);
            details.push(d);
          }
        }
        f.tracking
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((n) => nums.add(n));
        f.trackingUrls.forEach((u) => urls.add(u));
      }
      out[order] = {
        numbers: Array.from(nums),
        urls: Array.from(urls),
        details,
      };
    }
    return out;
  }, [bySalesOrder]);

  const value: OrderTrackingState = useMemo(
    () => ({
      loading,
      error,
      customerId,
      fulfillments,
      lastLoadedAt,
      bySalesOrder,
      trackingByOrder,
      refresh,
      setFulfillments,
    }),
    [
      loading,
      error,
      customerId,
      fulfillments,
      lastLoadedAt,
      bySalesOrder,
      trackingByOrder,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrderTracking() {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error(
      "useOrderTracking must be used within OrderTrackingProvider"
    );
  return ctx;
}
