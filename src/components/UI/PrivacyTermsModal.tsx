"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type TabKey = "summary" | "privacy" | "terms" | "accessibility";
type Sources = {
  summary: string;
  privacy: string;
  terms: string;
  accessibility?: string;
};

export default function PrivacyTermsModal({
  open,
  onClose,
  initialTab = "summary",
  sources,
}: {
  open: boolean;
  onClose: () => void;
  initialTab?: TabKey;
  sources: Sources;
}) {
  const [tab, setTab] = React.useState<TabKey>(initialTab);
  const cacheRef = React.useRef(new Map<TabKey, string>());
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => setTab(initialTab), [initialTab, open]);

  // esc to close + lock scroll
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const tabList = [
    { key: "summary" as const, label: "Summary", present: true },
    { key: "privacy" as const, label: "Privacy Policy", present: true },
    { key: "terms" as const, label: "Terms & Conditions", present: true },
    ...(sources.accessibility
      ? [
          {
            key: "accessibility" as const,
            label: "Accessibility",
            present: true,
          },
        ]
      : []),
  ] satisfies { key: TabKey; label: string; present: boolean }[];

  const urlFor = (k: TabKey) =>
    k === "summary"
      ? sources.summary
      : k === "privacy"
      ? sources.privacy
      : k === "terms"
      ? sources.terms
      : sources.accessibility || "";

  const isMd = (k: TabKey) => {
    const u = urlFor(k).toLowerCase();
    return u.endsWith(".md") || u.endsWith(".markdown");
  };

  const isDev = process.env.NODE_ENV !== "production";

  async function ensureLoaded(k: TabKey) {
    if (!isDev && cacheRef.current.has(k)) return;
    setLoading(true);
    setErr(null);
    try {
      const path = urlFor(k);
      const base =
        typeof window !== "undefined"
          ? window.location.origin
          : "http://localhost";
      const url = new URL(path, base);
      if (isDev) url.searchParams.set("t", String(Date.now())); // dev cache-bust

      const r = await fetch(url.toString(), {
        cache: isDev ? "no-store" : "force-cache",
      });
      if (!r.ok) throw new Error(`Fetch failed ${r.status} for ${url}`);
      const txt = await r.text();
      if (!txt?.trim()) throw new Error(`Empty document loaded from ${url}`);
      cacheRef.current.set(k, txt);
    } catch (e: any) {
      setErr(e?.message || "Could not load this document.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (open) ensureLoaded(tab);
  }, [open, tab]);

  const content = cacheRef.current.get(tab) || "";

  // Intercept Markdown links to switch tabs in-modal
  const goToHrefTab = (href?: string) => {
    if (!href) return false;
    try {
      const base =
        typeof window !== "undefined"
          ? window.location.origin
          : "http://localhost";
      const u = new URL(href, base);
      const p = u.pathname.toLowerCase();
      if (p.includes("/policies/privacy")) {
        setTab("privacy");
        return true;
      }
      if (p.includes("/policies/terms")) {
        setTab("terms");
        return true;
      }
      if (p.includes("/policies/accessibility")) {
        setTab("accessibility");
        return true;
      }
      if (p.includes("/policies/summary")) {
        setTab("summary");
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] grid place-items-center px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            className="relative z-[101] w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-[0_24px_80px_rgba(0,0,0,0.25)] ring-1 ring-slate-200"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-[#FFFEF4] via-white to-white px-5 py-4">
              <div className="text-base font-semibold text-slate-900">
                Policies & Terms
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5">
                  <path
                    fill="currentColor"
                    d="M6.4 19L5 17.6 10.6 12 5 6.4 6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4z"
                  />
                </svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="px-5 pt-4">
              <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
                {tabList.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`rounded-lg px-3 py-1.5 text-xs transition ${
                      tab === t.key
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:text-slate-900"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Body */}
            <div className="max-h-[65vh] overflow-y-auto px-5 py-5">
              {loading ? (
                <div className="space-y-3">
                  <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
                  <div className="h-4 w-5/6 animate-pulse rounded bg-slate-200" />
                  <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
                  <div className="h-4 w-4/5 animate-pulse rounded bg-slate-200" />
                </div>
              ) : err ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {err}
                </div>
              ) : isMd(tab) ? (
                <div className="max-w-none text-slate-900">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: (p) => (
                        <h1
                          className="mt-0 mb-4 text-2xl font-semibold"
                          {...p}
                        />
                      ),
                      h2: (p) => (
                        <h2
                          className="mt-6 mb-3 text-xl font-semibold"
                          {...p}
                        />
                      ),
                      h3: (p) => (
                        <h3
                          className="mt-5 mb-2 text-lg font-semibold"
                          {...p}
                        />
                      ),
                      p: (p) => <p className="my-2 leading-6" {...p} />,
                      ul: (p) => (
                        <ul className="my-3 ml-5 list-disc space-y-1" {...p} />
                      ),
                      ol: (p) => (
                        <ol
                          className="my-3 ml-5 list-decimal space-y-1"
                          {...p}
                        />
                      ),
                      li: (p) => <li className="leading-6" {...p} />,
                      a: ({ href, children, ...rest }) => {
                        const isMailto = href?.startsWith("mailto:");
                        const isHttp =
                          href?.startsWith("http://") ||
                          href?.startsWith("https://");
                        const onClick: React.MouseEventHandler<
                          HTMLAnchorElement
                        > = (e) => {
                          if (goToHrefTab(href)) {
                            e.preventDefault();
                            e.stopPropagation();
                          } else if (!isMailto && !isHttp) {
                            e.preventDefault();
                            e.stopPropagation();
                          }
                        };
                        return (
                          <a
                            href={href}
                            onClick={onClick}
                            className="underline underline-offset-4 hover:opacity-80"
                            {...rest}
                          >
                            {children}
                          </a>
                        );
                      },
                      strong: (p) => (
                        <strong className="font-semibold" {...p} />
                      ),
                      hr: (p) => (
                        <hr className="my-5 border-slate-200" {...p} />
                      ),
                      blockquote: (p) => (
                        <blockquote
                          className="my-3 border-l-4 border-slate-200 pl-3 text-slate-700"
                          {...p}
                        />
                      ),
                      code: (p) => (
                        <code
                          className="rounded bg-slate-100 px-1 py-0.5"
                          {...p}
                        />
                      ),
                      pre: (p) => (
                        <pre
                          className="my-3 overflow-x-auto rounded bg-slate-100 p-3 text-[13px] leading-6"
                          {...p}
                        />
                      ),
                    }}
                  >
                    {content}
                  </ReactMarkdown>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-900">
                  {content}
                </pre>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
              <button
                onClick={onClose}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
              >
                Close
              </button>
              <button
                onClick={onClose}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
              >
                I Agree
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
