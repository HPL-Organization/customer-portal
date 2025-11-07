"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const INACTIVITY_MS = 15 * 60 * 1000; // 15 minutes

const INTERVAL_MS = Math.max(
  1000,
  Math.min(60_000, Math.floor(INACTIVITY_MS / 2))
);
const LAST_ACTIVE_KEY = "hpl:lastActive";
const LOGOUT_BROADCAST_KEY = "hpl:idleLogout";

async function performCompatibleLogout(
  reason: "timedout" | "manual" = "timedout"
) {
  try {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
  } catch {}
  try {
    await supabase.auth.signOut({ scope: "global" });
  } catch {}
  try {
    Object.keys(localStorage).forEach((k) => {
      if (
        k.startsWith("sb-") ||
        k.includes("supabase") ||
        k === "nsId" ||
        k === "hsId"
      ) {
        localStorage.removeItem(k);
      }
    });
    sessionStorage.removeItem("name_prefill");
    localStorage.removeItem(LAST_ACTIVE_KEY);
  } catch {}
  const url = new URL(window.location.href);
  [
    "nsId",
    "netsuiteId",
    "netsuite_contact_id",
    "hsId",
    "hubspotId",
    "contactId",
  ].forEach((p) => url.searchParams.delete(p));
  const cleanSearch = url.searchParams.toString();
  const sanitizedNext = url.pathname + (cleanSearch ? `?${cleanSearch}` : "");
  const to = `/login?timedout=${
    reason === "timedout" ? "1" : "0"
  }&next=${encodeURIComponent(sanitizedNext)}`;
  window.location.replace(to);
}

export default function InactivityLogout() {
  const router = useRouter();
  const timerId = useRef<number | null>(null);
  const lastActiveRef = useRef<number>(Date.now());
  const enabledRef = useRef<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      enabledRef.current = !!data.session;
      if (!enabledRef.current) return;

      const now = Date.now();
      const storedRaw = localStorage.getItem(LAST_ACTIVE_KEY);
      const stored = storedRaw ? Number(storedRaw) : 0;
      lastActiveRef.current = stored || now;

      if (stored && now - stored >= INACTIVITY_MS) {
        enabledRef.current = false;
        try {
          localStorage.setItem(LOGOUT_BROADCAST_KEY, String(now));
        } catch {}
        await performCompatibleLogout("timedout");
        return;
      }

      lastActiveRef.current = now;
      localStorage.setItem(LAST_ACTIVE_KEY, String(now));

      const markActive = () => {
        if (!enabledRef.current) return;
        const t = Date.now();
        lastActiveRef.current = t;
        localStorage.setItem(LAST_ACTIVE_KEY, String(t));
      };

      const maybeLogout = async () => {
        if (!enabledRef.current) return;
        const storedLatest = Number(
          localStorage.getItem(LAST_ACTIVE_KEY) || "0"
        );
        const lastActive = Math.max(lastActiveRef.current, storedLatest || 0);
        const inactiveFor = Date.now() - lastActive;
        if (inactiveFor >= INACTIVITY_MS) {
          enabledRef.current = false;
          try {
            localStorage.setItem(LOGOUT_BROADCAST_KEY, String(Date.now()));
          } catch {}
          await performCompatibleLogout("timedout");
        }
      };

      const events = ["mousemove", "keydown", "scroll", "click", "focus"];
      events.forEach((evt) =>
        window.addEventListener(evt, markActive, { passive: true })
      );

      const onVisibility = () => {
        markActive();
        void maybeLogout();
      };
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("focus", onVisibility);

      const onStorage = (e: StorageEvent) => {
        if (e.key === LOGOUT_BROADCAST_KEY && e.newValue) {
          enabledRef.current = false;
          void performCompatibleLogout("timedout");
        }
      };
      window.addEventListener("storage", onStorage);

      timerId.current = window.setInterval(maybeLogout, INTERVAL_MS);

      return () => {
        events.forEach((evt) =>
          window.removeEventListener(evt, markActive as any)
        );
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("focus", onVisibility);
        window.removeEventListener("storage", onStorage);
        if (timerId.current) {
          clearInterval(timerId.current);
          timerId.current = null;
        }
      };
    })();

    return () => {
      cancelled = true;
      enabledRef.current = false;
      if (timerId.current) {
        clearInterval(timerId.current);
        timerId.current = null;
      }
    };
  }, [router]);

  return null;
}
