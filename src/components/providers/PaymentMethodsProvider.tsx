"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCustomerBootstrap } from "./CustomerBootstrap";

export type PaymentMethod = {
  id: string | number;
  type: "card" | "ach" | "other";
  brand?: string;
  last4?: string;
  exp?: string;
  name?: string;
  isDefault?: boolean;
  tokenFamilyLabel?: string;
};

type CtxShape = {
  loading: boolean;
  error: string | null;
  methods: PaymentMethod[];
  hasAnyMethod: boolean;
  hasCardOnFile: boolean;
  customerId: number | null;
  lastLoadedAt: number | null;
  refresh: () => Promise<void>;
  setMethods: React.Dispatch<React.SetStateAction<PaymentMethod[]>>;
};

const Ctx = createContext<CtxShape | undefined>(undefined);

function normalize(raw: any, idx: number): PaymentMethod {
  const id = raw.id ?? raw.internalId ?? raw.paymentCardTokenId ?? idx;
  const pmStr = String(raw.paymentMethod ?? raw.type ?? "").toLowerCase();
  const type: "card" | "ach" | "other" =
    pmStr.includes("ach") || pmStr.includes("bank")
      ? "ach"
      : pmStr.includes("card") || pmStr.includes("token")
      ? "card"
      : "other";
  const brand = raw.brand ?? raw.cardBrand ?? undefined;
  const last4 =
    (
      raw.accountNumberLastFour ??
      raw.last4 ??
      raw.cardLast4 ??
      ""
    ).toString() || undefined;
  let exp = raw.tokenExpirationDate ?? raw.exp ?? raw.expiry ?? undefined;
  if (typeof exp === "string") {
    const m = exp.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) exp = `${m[2]}/${m[1].slice(-2)}`;
    const m2 = exp.match(/^(\d{2})\/(\d{4})$/);
    if (m2) exp = `${m2[1]}/${m2[2].slice(-2)}`;
  }
  const name = raw.cardNameOnCard ?? raw.name ?? raw.accountHolder ?? undefined;
  const tokenFamilyLabel =
    raw.tokenFamily ?? raw.tokenFamilyLabel ?? raw.gateway ?? "Versapay";
  const isDefault = Boolean(
    raw.isDefault ?? raw.default ?? raw.primary ?? false
  );
  return { id, type, brand, last4, exp, name, isDefault, tokenFamilyLabel };
}

async function fetchPaymentMethods(
  customerId: number
): Promise<PaymentMethod[]> {
  try {
    const res = await fetch(`/api/netsuite/get-payment-method`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerInternalId: Number(customerId) }),
      cache: "no-store",
    });
    const text = await res.text();
    let data: any;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok || data?.success === false) return [];
    const raw: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.data?.instruments)
      ? data.data.instruments
      : Array.isArray(data?.instruments)
      ? data.instruments
      : [];
    return raw.map((r: any, i: number) => normalize(r, i));
  } catch {
    return [];
  }
}

export default function PaymentMethodsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { nsId, initialized } = useCustomerBootstrap();
  const [loading, setLoading] = useState(false);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const numericCustomerId = useMemo(() => {
    if (!nsId) return null;
    const n = Number(nsId);
    return Number.isFinite(n) ? n : null;
  }, [nsId]);

  const runFetch = async (signal?: AbortSignal) => {
    if (!numericCustomerId) {
      setMethods([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await fetchPaymentMethods(numericCustomerId);
      setMethods(list);
      setLastLoadedAt(Date.now());
    } catch (e: any) {
      if (e?.name !== "AbortError")
        setError(e?.message || "Failed to load payment methods");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialized) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    void runFetch(ac.signal);
    return () => ac.abort();
  }, [initialized, numericCustomerId]);

  const refresh = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    await runFetch(ac.signal);
    ac.abort();
  };

  const hasAnyMethod = methods.length > 0;
  const hasCardOnFile = methods.some((m) => m.type === "card");

  const value = useMemo(
    () => ({
      loading,
      error,
      methods,
      hasAnyMethod,
      hasCardOnFile,
      customerId: numericCustomerId,
      lastLoadedAt,
      refresh,
      setMethods,
    }),
    [
      loading,
      error,
      methods,
      hasAnyMethod,
      hasCardOnFile,
      numericCustomerId,
      lastLoadedAt,
      refresh,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePaymentMethods() {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error(
      "usePaymentMethods must be used within PaymentMethodsProvider"
    );
  return ctx;
}
