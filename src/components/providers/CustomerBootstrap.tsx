"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";

type HubSpotContact = any;

type BootstrapState = {
  nsId: string | null;
  hsId: string | null;
  initialized: boolean;
  loading: boolean;
  error?: string | null;
  refresh: () => Promise<void>;
  setNsId: (id: string | null) => void;

  contact: HubSpotContact | null;
  contactLoading: boolean;
  contactError?: string | null;
  refreshContact: () => Promise<void>;
  setHsId: (id: string | null) => void;
};

const Ctx = createContext<BootstrapState | undefined>(undefined);

async function resolveHubSpotId(nsId: string) {
  try {
    const r1 = await fetch(
      `/api/supabase/get-customer-info?nsId=${encodeURIComponent(nsId)}`,
      { cache: "no-store" }
    );
    if (r1.ok) {
      const body = await r1.json();
      const hubspotId = body?.data?.hubspot_id as string | number | null;
      console.log("Hubspot id from Hubspot", hubspotId);
      if (hubspotId) {
        return { hsId: String(hubspotId), error: null };
      }
    }
  } catch {}

  const r = await fetch(
    `/api/netsuite/get-hubspot-contact?nsId=${encodeURIComponent(nsId)}`,
    { cache: "no-store" }
  );
  if (!r.ok)
    return { hsId: null, error: (await r.text()) || "Failed to resolve" };
  const data = await r.json();
  return { hsId: (data?.hubspotId as string) ?? null, error: null };
}

function readFromUrlOrStorage() {
  if (typeof window === "undefined") {
    return { nsId: null, hsId: null };
  }
  const usp = new URLSearchParams(window.location.search);

  const urlNs =
    usp.get("nsId") || usp.get("netsuiteId") || usp.get("netsuite_contact_id");
  const urlHs = usp.get("hsId") || usp.get("hubspotId") || usp.get("contactId");

  if (urlNs) localStorage.setItem("nsId", urlNs);
  if (urlHs) localStorage.setItem("hsId", urlHs);

  return {
    nsId: urlNs ?? localStorage.getItem("nsId") ?? null,
    hsId: urlHs ?? localStorage.getItem("hsId") ?? null,
  };
}

export default function CustomerBootstrap({
  children,
}: {
  children: React.ReactNode;
}) {
  const sp = useSearchParams();

  const seed = readFromUrlOrStorage();
  const [nsId, setNsId] = useState<string | null>(seed.nsId);
  const [hsId, setHsId] = useState<string | null>(seed.hsId);

  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [contact, setContact] = useState<HubSpotContact | null>(null);
  const [contactLoading, setContactLoading] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);

  useEffect(() => {
    const urlNs =
      sp.get("nsId") || sp.get("netsuiteId") || sp.get("netsuite_contact_id");
    const urlHs = sp.get("hsId") || sp.get("hubspotId") || sp.get("contactId");

    if (urlNs && urlNs !== nsId) {
      localStorage.setItem("nsId", urlNs);
      setNsId(urlNs);
    }
    if (urlHs && urlHs !== hsId) {
      localStorage.setItem("hsId", urlHs);
      setHsId(urlHs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  const doRefresh = async () => {
    if (!nsId) {
      setError(null);
      setInitialized(true);
      setLoading(false);
      return;
    }

    if (hsId) {
      setInitialized(true);
      return;
    }

    setLoading(true);
    setError(null);
    const { hsId: resolved, error: err } = await resolveHubSpotId(nsId);
    setHsId(resolved);
    if (resolved) localStorage.setItem("hsId", resolved);
    setError(err ?? null);
    setInitialized(true);
    setLoading(false);
  };

  useEffect(() => {
    void doRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nsId]);

  const fetchContact = async (signal?: AbortSignal) => {
    if (!hsId) {
      setContact(null);
      setContactError(null);
      setContactLoading(false);
      return;
    }
    setContactLoading(true);
    setContactError(null);
    try {
      const r = await fetch(
        `/api/hubspot/contact?contactId=${encodeURIComponent(hsId)}`,
        { cache: "no-store", signal }
      );
      if (!r.ok) {
        const msg = await r.text();
        throw new Error(msg || `Failed to load HubSpot contact (${r.status})`);
      }
      const data = await r.json();
      setContact(data ?? null);
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setContact(null);
        setContactError(e?.message || "Failed to load contact");
      }
    } finally {
      setContactLoading(false);
    }
  };

  useEffect(() => {
    const ac = new AbortController();
    setContact(null);
    setContactError(null);
    if (hsId) {
      void fetchContact(ac.signal);
    } else {
      setContactLoading(false);
    }
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hsId]);

  const refreshContact = async () => {
    const ac = new AbortController();
    await fetchContact(ac.signal);
    ac.abort();
  };

  const value = useMemo(
    () => ({
      nsId,
      hsId,
      initialized,
      loading,
      error,
      refresh: doRefresh,
      setNsId,

      contact,
      contactLoading,
      contactError,
      refreshContact,
      setHsId,
    }),
    [
      nsId,
      hsId,
      initialized,
      loading,
      error,
      contact,
      contactLoading,
      contactError,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCustomerBootstrap() {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error(
      "useCustomerBootstrap must be used within CustomerBootstrap"
    );
  return ctx;
}
