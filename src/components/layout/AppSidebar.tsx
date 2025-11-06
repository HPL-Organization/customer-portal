"use client";

import { Menu, X, LogOut } from "lucide-react";
import { NAV_ITEMS } from "@/lib/constants/nav";
import NavItem from "@/components/nav/NavItem";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function toPossessiveFirst(name: string | null | undefined) {
  const raw = String(name || "").trim();
  if (!raw) return null;
  const first = raw.split(/\s+/)[0];
  if (!first) return null;
  const endsWithS = /s$/i.test(first);
  return endsWithS ? `${first}'` : `${first}'s`;
}

function extractDisplayName(u: any | null) {
  if (!u) return null;
  const md = u.user_metadata || {};
  const m1 =
    md.display_name ||
    md.full_name ||
    md.name ||
    md.user_name ||
    md.given_name ||
    null;
  if (m1) return String(m1);
  const ids: any[] = Array.isArray(u.identities) ? u.identities : [];
  for (const ident of ids) {
    const idd = ident?.identity_data || {};
    const n =
      idd.given_name ||
      idd.full_name ||
      idd.name ||
      idd.preferred_username ||
      null;
    if (n) return String(n);
  }
  const email = String(u.email || "").trim();
  if (email) {
    const local = email.split("@")[0] || "";
    if (local) {
      return local
        .split(/[._-]+/)
        .filter(Boolean)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" ");
    }
  }
  return null;
}

export default function AppSidebar() {
  const [open, setOpen] = useState(false);
  const [portalLabel, setPortalLabel] = useState<string | null>(null);

  const pathname = usePathname();
  const activeHref = useMemo(() => {
    if (!pathname) return "";
    const found = NAV_ITEMS.find(
      (n) => pathname === n.href || pathname.startsWith(`${n.href}/`)
    );
    return found?.href ?? "";
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data.user || null;
        const display = extractDisplayName(user);
        const poss = toPossessiveFirst(display);
        if (!cancelled) setPortalLabel(poss);
      } catch {
        if (!cancelled) setPortalLabel(null);
      }
    }
    load();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const user = session?.user || null;
      const display = extractDisplayName(user);
      const poss = toPossessiveFirst(display);
      setPortalLabel(poss);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
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

    window.location.replace(`/login?next=${encodeURIComponent(sanitizedNext)}`);
  }

  const headerText = portalLabel ? `${portalLabel} Portal` : "Customer Portal";

  return (
    <>
      <motion.aside
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: "spring", stiffness: 140, damping: 18, mass: 0.9 }}
        className="sticky top-0 hidden h-screen w-72 flex-col border-r border-neutral-400 bg-[#BFBFBF] p-3 xl:flex"
      >
        <div className="relative rounded-2xl p-3 shadow-inner ring-1 ring-white/10">
          <div className="flex items-center gap-3 rounded-xl bg-white/30 p-2 backdrop-blur-sm ring-1 ring-white/30">
            <motion.img
              src="/HPL_logo.png"
              alt="HPL logo"
              className="h-10 w-10 rounded-full object-contain ring-2 ring-white/60 shadow"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 220, damping: 16 }}
            />
            <div className="leading-tight">
              <h1 className="text-[15px] font-extrabold tracking-tight text-neutral-900">
                {headerText}
              </h1>
              <span className="text-[11px] font-medium text-neutral-700/80">
                Highland Park Lapidary
              </span>
            </div>
          </div>

          <nav className="mt-6">
            <ul className="relative space-y-1">
              <AnimatePresence initial={false}>
                {NAV_ITEMS.map((it) => {
                  const isActive = it.href === activeHref;
                  return (
                    <li key={it.href} className="relative">
                      {isActive && (
                        <motion.div
                          layoutId="active-pill"
                          className="absolute inset-0 rounded-xl bg-white/8 ring-1 ring-black/10"
                          transition={{
                            type: "spring",
                            stiffness: 400,
                            damping: 36,
                          }}
                        />
                      )}
                      <motion.div
                        whileHover={{ x: 4 }}
                        transition={{
                          type: "spring",
                          stiffness: 340,
                          damping: 26,
                        }}
                        className="relative group"
                      >
                        <div className="rounded-xl px-1 py-0.5">
                          <NavItem
                            href={it.href}
                            label={it.label}
                            icon={it.icon}
                          />
                        </div>
                      </motion.div>
                    </li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </nav>

          <div className="mt-6 h-px w-full bg-gradient-to-r from-transparent via-neutral-500/40 to-transparent" />

          <motion.button
            whileTap={{ scale: 0.98 }}
            whileHover={{ y: -1 }}
            onClick={handleLogout}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-white/80 px-3 py-2 text-sm font-semibold text-neutral-900 shadow-sm outline-none ring-1 ring-neutral-400 hover:bg-white focus-visible:ring-2 focus-visible:ring-black/30"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </motion.button>
        </div>
      </motion.aside>

      <div className="xl:hidden">
        <div className="sticky top-0 z-40 flex items-center gap-2 border-b border-neutral-400 bg-[#BFBFBF] p-3">
          <button
            aria-label="Open navigation"
            className="rounded-lg p-2 outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-black/30"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="flex items-center gap-3">
            <img
              src="/HPL_logo.png"
              alt="HPL logo"
              className="h-8 w-8 rounded-full object-contain ring-2 ring-slate-200 shadow"
            />
            <span className="font-semibold text-neutral-900">{headerText}</span>
          </div>
        </div>

        <AnimatePresence>
          {open && (
            <>
              <motion.div
                className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setOpen(false)}
              />
              <motion.aside
                className="fixed inset-y-0 left-0 z-50 w-80 p-3"
                initial={{ x: -340 }}
                animate={{ x: 0 }}
                exit={{ x: -340 }}
                transition={{ type: "spring", stiffness: 300, damping: 32 }}
                aria-label="Primary"
                role="dialog"
                aria-modal="true"
              >
                <div className="h-full rounded-r-2xl border-r border-neutral-400 bg-[#BFBFBF] p-4 shadow-xl ring-1 ring-white/10">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <img
                        src="/HPL_logo.png"
                        alt="HPL logo"
                        className="h-8 w-8 rounded-full object-contain ring-2 ring-slate-200 shadow"
                      />
                      <span className="font-semibold text-neutral-900">
                        Navigation
                      </span>
                    </div>
                    <button
                      aria-label="Close navigation"
                      className="rounded-lg p-2 outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-black/30"
                      onClick={() => setOpen(false)}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <ul className="relative space-y-1">
                    <AnimatePresence initial={false}>
                      {NAV_ITEMS.map((it) => {
                        const isActive = it.href === activeHref;
                        return (
                          <li key={it.href} className="relative">
                            {isActive && (
                              <motion.div
                                layoutId="active-pill-mobile"
                                className="absolute inset-0 rounded-xl bg-white/8 ring-1 ring-black/10"
                                transition={{
                                  type: "spring",
                                  stiffness: 400,
                                  damping: 36,
                                }}
                              />
                            )}
                            <motion.div
                              whileHover={{ x: 4 }}
                              transition={{
                                type: "spring",
                                stiffness: 340,
                                damping: 26,
                              }}
                              className="relative"
                            >
                              <NavItem
                                href={it.href}
                                label={it.label}
                                icon={it.icon}
                                onClick={() => setOpen(false)}
                              />
                            </motion.div>
                          </li>
                        );
                      })}
                    </AnimatePresence>
                  </ul>

                  <div className="mt-auto pt-6">
                    <div className="mb-4 h-px w-full bg-gradient-to-r from-transparent via-neutral-500/40 to-transparent" />
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      whileHover={{ y: -1 }}
                      onClick={async () => {
                        setOpen(false);
                        await handleLogout();
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/80 px-3 py-2 text-sm font-semibold text-neutral-900 shadow-sm outline-none ring-1 ring-neutral-400 hover:bg-white focus-visible:ring-2 focus-visible:ring-black/30"
                    >
                      <LogOut className="h-4 w-4" />
                      Log out
                    </motion.button>
                  </div>
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
