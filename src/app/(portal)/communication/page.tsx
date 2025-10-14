"use client";

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  Bell,
  Mail,
  MessageSquare,
  Phone,
  Search,
  Check,
  Sparkles,
  RefreshCw,
  Save,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCustomerBootstrap } from "@/components/providers/CustomerBootstrap";
import {
  Backdrop,
  CircularProgress,
  Typography,
  Box,
  Portal,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Divider,
} from "@mui/material";

type Channel = "email" | "sms" | "phone";

type Item = {
  categoryId: number;
  title: string;
  subscribed: boolean;
  channels: { email: boolean; sms: boolean; phone: boolean };
  frequencyId: number | null;
  recordId?: number | null;
};

const FREQ_OPTIONS: Array<{ id: number; label: string }> = [
  { id: 1, label: "Real-Time" },
  { id: 2, label: "Weekly" },
  { id: 3, label: "Monthly" },
];

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
        checked ? "bg-red-600" : "bg-slate-300"
      } focus:outline-none focus:ring-2 focus:ring-red-300`}
    >
      <span className="sr-only">{label || "toggle"}</span>
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function Badge({
  tone = "slate",
  children,
}: {
  tone?: "emerald" | "slate" | "red";
  children: React.ReactNode;
}) {
  const map: Record<string, string> = {
    emerald: "text-emerald-700 bg-emerald-50 border border-emerald-200",
    slate: "text-slate-600 bg-slate-50 border border-slate-200",
    red: "text-red-700 bg-red-50 border border-red-200",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${map[tone]}`}
    >
      {children}
    </span>
  );
}

function ChannelPill({
  active,
  onClick,
  icon: Icon,
  label,
  tone = "red",
}: {
  active: boolean;
  onClick: () => void;
  icon: any;
  label: string;
  tone?: "red" | "blue";
}) {
  const on =
    tone === "red"
      ? "ring-red-200 text-red-700 bg-red-50"
      : "ring-blue-200 text-blue-700 bg-blue-50";
  const off = "ring-slate-200 text-slate-600 bg-white hover:bg-slate-50";
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ring-1 ${
        active ? on : off
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
      {active && <Check className="h-4 w-4" />}
    </button>
  );
}

function ItemCard({
  item,
  onToggleSubscribe,
  onToggleChannel,
  onChangeFrequency,
}: {
  item: Item;
  onToggleSubscribe: (categoryId: number) => void;
  onToggleChannel: (categoryId: number, ch: Channel) => void;
  onChangeFrequency: (categoryId: number, freqId: number) => void;
}) {
  const subscribed = item.subscribed;
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words text-[15px] font-semibold leading-5 text-slate-900">
                {item.title}
              </h3>
              {subscribed ? (
                <Badge tone="emerald">
                  <Check className="h-3.5 w-3.5" />
                  Subscribed
                </Badge>
              ) : (
                <Badge>Not subscribed</Badge>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-slate-500">Subscribe</span>
            <Switch
              checked={subscribed}
              onChange={() => onToggleSubscribe(item.categoryId)}
              label={`Subscribe to ${item.title}`}
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Frequency
          </div>
          {subscribed ? (
            <div className="mt-2">
              <select
                value={item.frequencyId ?? ""}
                onChange={(e) =>
                  onChangeFrequency(item.categoryId, Number(e.target.value))
                }
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-slate-200"
              >
                <option value="" disabled>
                  Select frequency…
                </option>
                {FREQ_OPTIONS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-500">
              Subscribe to set frequency
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Delivery via
          </div>
          {subscribed ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ChannelPill
                active={item.channels.email}
                onClick={() => onToggleChannel(item.categoryId, "email")}
                icon={Mail}
                label="Email"
                tone="red"
              />
              <ChannelPill
                active={item.channels.sms}
                onClick={() => onToggleChannel(item.categoryId, "sms")}
                icon={MessageSquare}
                label="SMS"
                tone="blue"
              />
              <ChannelPill
                active={item.channels.phone}
                onClick={() => onToggleChannel(item.categoryId, "phone")}
                icon={Phone}
                label="Phone"
                tone="blue"
              />
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-500">
              Subscribe to enable channels
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export default function CommunicationPreferencesPage() {
  const params = useSearchParams();
  const queryCustomerId = params.get("customerId");
  const bootstrap = useCustomerBootstrap();
  const providerCustomerId =
    (bootstrap as any)?.nsId ??
    (bootstrap as any)?.nsid ??
    (bootstrap as any)?.customerId ??
    "";
  const resolvedCustomerId =
    queryCustomerId || String(providerCustomerId) || "";

  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState("");
  const [subsOnly, setSubsOnly] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const allowNextNavRef = useRef(false);
  const [navOpen, setNavOpen] = useState(false);
  const navHrefRef = useRef<string | null>(null);
  const navKindRef = useRef<"href" | "back" | null>(null);

  useEffect(() => {
    const isSameOrigin = (href: string) => {
      try {
        const u = new URL(href, window.location.href);
        return u.origin === window.location.origin;
      } catch {
        return false;
      }
    };
    const isInternalPath = (href: string) => {
      try {
        const u = new URL(href, window.location.href);
        return isSameOrigin(href) && u.pathname !== window.location.pathname;
      } catch {
        return false;
      }
    };
    const openPrompt = (kind: "href" | "back", href: string | null) => {
      navKindRef.current = kind;
      navHrefRef.current = href;
      setNavOpen(true);
    };
    const handleClick = (e: MouseEvent) => {
      if (!dirty || allowNextNavRef.current) return;
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      let el = e.target as HTMLElement | null;
      while (el && el !== document.body) {
        if (el instanceof HTMLAnchorElement && el.href) {
          if (
            !el.target &&
            isInternalPath(el.href) &&
            !el.href.startsWith("mailto:") &&
            !el.href.startsWith("tel:")
          ) {
            e.preventDefault();
            openPrompt("href", el.href);
            return;
          }
          break;
        }
        el = el.parentElement;
      }
    };
    const handlePopState = () => {
      if (!dirty || allowNextNavRef.current) return;
      history.pushState(null, "", window.location.href);
      openPrompt("back", null);
    };
    document.addEventListener("click", handleClick, true);
    window.addEventListener("popstate", handlePopState);
    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [dirty]);

  const proceedNavigation = () => {
    allowNextNavRef.current = true;
    setNavOpen(false);
    if (navKindRef.current === "href" && navHrefRef.current) {
      window.location.href = navHrefRef.current;
    } else if (navKindRef.current === "back") {
      history.back();
    }
  };

  const cancelNavigation = () => {
    setNavOpen(false);
    navKindRef.current = null;
    navHrefRef.current = null;
  };

  useEffect(() => {
    (async () => {
      if (!resolvedCustomerId) return;
      setLoading(true);
      try {
        const [catsRes, prefsRes] = await Promise.all([
          fetch("/api/netsuite/communication-categories"),
          fetch(
            `/api/netsuite/get-customer-communication-preferences?customerId=${encodeURIComponent(
              resolvedCustomerId
            )}`
          ),
        ]);
        const cats = await catsRes.json();
        const prefs = await prefsRes.json();
        const byCat: Record<string, any> = (prefs?.preferences || []).reduce(
          (acc: any, p: any) => {
            acc[String(p.categoryId)] = p;
            return acc;
          },
          {}
        );
        const next: Item[] = (cats?.items || []).map((c: any) => {
          const p = byCat[String(c.id)];
          return {
            categoryId: Number(c.id),
            title: String(c.name),
            subscribed: !!p?.optIn,
            channels: {
              email: !!p?.email,
              sms: !!p?.sms,
              phone: !!p?.phone,
            },
            frequencyId: p?.frequencyId ?? null,
            recordId: p?.recordId ?? null,
          };
        });
        setItems(next);
        setDirty(false);
      } catch {
        toast.error("Failed to load communication preferences.");
      } finally {
        setLoading(false);
      }
    })();
  }, [resolvedCustomerId]);

  const totals = useMemo(() => {
    const sub = items.filter((i) => i.subscribed).length;
    return { sub, all: items.length };
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      const matches = !q || i.title.toLowerCase().includes(q);
      const passSubs = !subsOnly || i.subscribed;
      return matches && passSubs;
    });
  }, [items, query, subsOnly]);

  const markDirty = () => setDirty(true);

  function toggleSubscribe(categoryId: number) {
    setItems((prev) =>
      prev.map((i) =>
        i.categoryId !== categoryId
          ? i
          : i.subscribed
          ? {
              ...i,
              subscribed: false,
              channels: { email: false, sms: false, phone: false },
            }
          : {
              ...i,
              subscribed: true,
              channels: { email: true, sms: false, phone: false },
              frequencyId: i.frequencyId ?? 1,
            }
      )
    );
    markDirty();
  }

  function toggleChannel(categoryId: number, ch: Channel) {
    setItems((prev) =>
      prev.map((i) =>
        i.categoryId !== categoryId || !i.subscribed
          ? i
          : { ...i, channels: { ...i.channels, [ch]: !i.channels[ch] } }
      )
    );
    markDirty();
  }

  function changeFrequency(categoryId: number, freqId: number) {
    setItems((prev) =>
      prev.map((i) =>
        i.categoryId !== categoryId ? i : { ...i, frequencyId: freqId }
      )
    );
    markDirty();
  }

  function setAll(v: boolean) {
    setItems((prev) =>
      prev.map((i) => ({
        ...i,
        subscribed: v,
        channels: v
          ? { email: true, sms: false, phone: false }
          : { email: false, sms: false, phone: false },
        frequencyId: v ? i.frequencyId ?? 1 : i.frequencyId,
      }))
    );
    markDirty();
  }

  async function onSave() {
    const cid = Number(resolvedCustomerId);
    if (!cid || !Number.isFinite(cid)) {
      toast.error("Missing customerId");
      return;
    }
    setSaving(true);
    try {
      const prefs = items
        .filter((i) => i.subscribed || i.recordId != null)
        .map((i) => ({
          recordId: i.recordId ?? undefined,
          categoryId: i.categoryId,
          frequencyId: i.frequencyId ?? undefined,
          optIn: i.subscribed,
          email: i.channels.email,
          sms: i.channels.sms,
          phone: i.channels.phone,
        }));
      const r = await fetch("/api/netsuite/save-communication-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: cid, preferences: prefs }),
      });
      const data = await r.json();
      if (!r.ok || data?.error) {
        throw new Error(data?.error || "Failed to save");
      }
      toast.success("Communication preferences saved.");
      setDirty(false);
      const p = await fetch(
        `/api/netsuite/get-customer-communication-preferences?customerId=${cid}`
      ).then((x) => x.json());
      const byCat: Record<string, any> = (p?.preferences || []).reduce(
        (acc: any, a: any) => {
          acc[String(a.categoryId)] = a;
          return acc;
        },
        {}
      );
      setItems((prev) =>
        prev.map((i) => {
          const rec = byCat[String(i.categoryId)];
          return rec
            ? {
                ...i,
                recordId: rec.recordId,
                subscribed: !!rec.optIn,
                channels: {
                  email: !!rec.email,
                  sms: !!rec.sms,
                  phone: !!rec.phone,
                },
                frequencyId: rec.frequencyId ?? null,
              }
            : i;
        })
      );
    } catch (e: any) {
      toast.error(e?.message || "Failed to save preferences.");
    } finally {
      setSaving(false);
      allowNextNavRef.current = false;
      navKindRef.current = null;
      navHrefRef.current = null;
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-28 pt-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Communication Preferences
          </h1>
          <p className="text-sm text-slate-600">
            Choose what you receive and how you receive it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
            <Bell className="h-4 w-4 text-slate-500" />
            <span className="font-semibold">{totals.sub}</span>
            <span className="text-slate-400">/ {totals.all} subscribed</span>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="mb-5 space-y-2 md:grid md:grid-cols-[1fr,auto] md:gap-3 md:space-y-0">
        <div>
          <label className="relative block w-full">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name…"
              className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none focus:ring-2 focus:ring-slate-200"
            />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={subsOnly}
              onChange={() => setSubsOnly((v) => !v)}
              className="h-4 w-4 accent-red-600"
            />
            Subscribed only
          </label>
          <button
            onClick={() => setAll(true)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            Select All
          </button>
          <button
            onClick={() => setAll(false)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            Clear All
          </button>
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.length === 0 && (
          <li className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
            No items match your filters.
          </li>
        )}
        {filtered.map((i) => (
          <ItemCard
            key={i.categoryId}
            item={i}
            onToggleSubscribe={toggleSubscribe}
            onToggleChannel={toggleChannel}
            onChangeFrequency={changeFrequency}
          />
        ))}
      </ul>

      <aside className="relative mt-8 hidden lg:block">
        <div className="sticky top-10 mt-8 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-red-600" />
              <h3 className="text-base font-semibold text-slate-900">
                Review & Save
              </h3>
            </div>
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Subscribed</span>
                  <span className="font-semibold text-slate-900">
                    {totals.sub}
                  </span>
                </div>
              </div>
            </div>
            <button
              disabled={!dirty || saving}
              onClick={onSave}
              className={`h-11 w-full rounded-lg text-sm font-semibold text-white transition ${
                !dirty || saving
                  ? "cursor-not-allowed bg-slate-300"
                  : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {saving
                ? "Saving…"
                : dirty
                ? "Save Preferences"
                : "No changes to save"}
            </button>
            <div className="mt-2 text-center text-xs text-slate-500">
              {dirty ? "Unsaved changes" : "All changes saved"}
            </div>
          </div>
        </div>
      </aside>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 mx-auto block max-w-7xl px-4 pb-6 lg:hidden">
        <div className="pointer-events-auto flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          <div className="text-xs">
            <div className="font-semibold text-slate-900">
              {totals.sub} subscribed{" "}
              <span className="text-slate-400">/ {totals.all}</span>
            </div>
            {dirty ? (
              <div className="text-[11px] text-red-600">Unsaved changes</div>
            ) : (
              <div className="text-[11px] text-slate-500">
                All changes saved
              </div>
            )}
          </div>
          <button
            disabled={!dirty || saving}
            onClick={onSave}
            className={`h-10 rounded-lg px-5 text-sm font-semibold text-white ${
              !dirty || saving
                ? "cursor-not-allowed bg-slate-300"
                : "bg-red-600"
            }`}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <Portal>
        <Backdrop
          open={saving}
          sx={{
            color: "#fff",
            zIndex: 2147483647,
            flexDirection: "column",
            gap: 2,
          }}
        >
          <CircularProgress />
          <Typography sx={{ fontWeight: 600 }}>
            Saving your preferences…
          </Typography>
          <Box sx={{ width: 320, mt: 1 }}>
            <LinearProgress />
          </Box>
        </Backdrop>
      </Portal>

      <Dialog
        open={navOpen}
        onClose={cancelNavigation}
        aria-labelledby="unsaved-dialog-title"
        PaperProps={{
          sx: {
            borderRadius: 3,
            width: 520,
            maxWidth: "90vw",
            boxShadow:
              "0 10px 30px rgba(2,6,23,0.25), 0 1px 0 rgba(2,6,23,0.05)",
          },
        }}
      >
        <DialogTitle id="unsaved-dialog-title" sx={{ pb: 1 }}>
          <Box className="flex items-center gap-3">
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: "9999px",
                backgroundColor: "#fee2e2",
                display: "grid",
                placeItems: "center",
              }}
            >
              <Save className="h-4 w-4" color="#b91c1c" />
            </Box>
            <Box>
              <Typography sx={{ fontWeight: 700, fontSize: 18 }}>
                Leave without saving?
              </Typography>
              <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                You have unsaved changes on this page.
              </Typography>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Box className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
              If you leave now, your changes will be discarded. To keep them,
              click Save first.
            </Typography>
          </Box>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2, gap: 1.5 }}>
          <Button
            onClick={cancelNavigation}
            variant="outlined"
            sx={{
              textTransform: "none",
              borderRadius: 2,
              borderColor: "rgba(100,116,139,0.4)",
            }}
          >
            Stay on this page
          </Button>
          <Button
            onClick={proceedNavigation}
            variant="contained"
            sx={{
              textTransform: "none",
              borderRadius: 2,
              backgroundColor: "#dc2626",
              "&:hover": { backgroundColor: "#b91c1c" },
            }}
          >
            Discard & leave
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
