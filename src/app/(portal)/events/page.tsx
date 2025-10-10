"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import {
  Bell,
  Mail,
  MessageSquare,
  Search,
  Check,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCustomerBootstrap } from "@/components/providers/CustomerBootstrap";

type Channel = "email" | "sms";
type Item = {
  id: string;
  title: string;
  description?: string;
  subscribed: boolean;
  channels: { email: boolean; sms: boolean };
  recordId?: number | null;
};
type Section = {
  id: string;
  title: string;
  subtitle?: string;
  items: Item[];
  footnote?: string;
};

function makeItem(id: string, title: string, description?: string): Item {
  return {
    id,
    title,
    description,
    subscribed: false,
    channels: { email: false, sms: false },
    recordId: null,
  };
}

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
  sectionId,
  item,
  onToggleSubscribe,
  onToggleChannel,
}: {
  sectionId: string;
  item: Item;
  onToggleSubscribe: (sid: string, iid: string) => void;
  onToggleChannel: (sid: string, iid: string, ch: Channel) => void;
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
            {item.description && (
              <p className="mt-1 text-sm leading-5 text-slate-600">
                {item.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-slate-500">Subscribe</span>
            <Switch
              checked={subscribed}
              onChange={() => onToggleSubscribe(sectionId, item.id)}
              label={`Subscribe to ${item.title}`}
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Delivery via
          </div>
          {subscribed ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ChannelPill
                active={item.channels.email}
                onClick={() => onToggleChannel(sectionId, item.id, "email")}
                icon={Mail}
                label="Email"
                tone="red"
              />
              <ChannelPill
                active={item.channels.sms}
                onClick={() => onToggleChannel(sectionId, item.id, "sms")}
                icon={MessageSquare}
                label="SMS"
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

export default function EventsPreferencesPage() {
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

  const [sections, setSections] = useState<Section[]>([
    {
      id: "live",
      title: "Live Events",
      subtitle: "Communities and live shows you can follow.",
      items: [],
    },
  ]);

  const [query, setQuery] = useState("");
  const [subsOnly, setSubsOnly] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);

  async function loadEventTypes() {
    setLoadingEvents(true);
    try {
      const r = await fetch("/api/netsuite/event-types");
      const data = await r.json();
      const live = sections.find((s) => s.id === "live");
      const prevState: Record<string, Item> = {};
      live?.items.forEach((i) => (prevState[i.id] = i));
      const items: Item[] =
        (data?.items || []).map((e: any) => {
          const id = String(e.id);
          const name = String(e.name);
          const prev = prevState[id];
          return prev ? { ...prev, title: name } : makeItem(id, name);
        }) || [];
      setSections((prev) =>
        prev.map((s) => (s.id === "live" ? { ...s, items } : s))
      );
    } catch {
      toast.error("Failed to load events from NetSuite");
    } finally {
      setLoadingEvents(false);
    }
  }

  async function loadSubscriptions(customerId: number) {
    if (!customerId) return;
    try {
      const r = await fetch(
        `/api/netsuite/get-customer-event-subscriptions?customerId=${encodeURIComponent(
          String(customerId)
        )}`
      );
      const data = await r.json();
      if (!r.ok || data?.error) throw new Error(data?.error || "Load failed");
      const records = (data?.subscriptions || []) as Array<{
        recordId: number;
        eventTypeId: number | string;
        email: boolean;
        sms: boolean;
        active: boolean;
        leaveDate: string | null;
      }>;
      setSections((prev) =>
        prev.map((s) =>
          s.id === "live"
            ? {
                ...s,
                items: s.items.map((it) => {
                  const rec = records.find(
                    (a) => String(a.eventTypeId) === String(it.id)
                  );
                  if (!rec) return it;
                  const on = rec.active && !rec.leaveDate;
                  return on
                    ? {
                        ...it,
                        subscribed: true,
                        channels: { email: !!rec.email, sms: !!rec.sms },
                        recordId: rec.recordId,
                      }
                    : {
                        ...it,
                        recordId: rec.recordId,
                      };
                }),
              }
            : s
        )
      );
    } catch (e: any) {
      toast.error(e?.message || "Failed to load subscriptions");
    }
  }

  useEffect(() => {
    (async () => {
      await loadEventTypes();
      const cid = Number(resolvedCustomerId);
      if (cid && Number.isFinite(cid)) {
        await loadSubscriptions(cid);
      }
    })();
  }, [resolvedCustomerId]);

  const totals = useMemo(() => {
    let sub = 0,
      all = 0;
    sections.forEach((s) =>
      s.items.forEach((i) => {
        all += 1;
        if (i.subscribed) sub += 1;
      })
    );
    return { sub, all };
  }, [sections]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sections.map((s) => ({
      ...s,
      items: s.items.filter((i) => {
        const matches =
          !q ||
          i.title.toLowerCase().includes(q) ||
          (i.description || "").toLowerCase().includes(q);
        const passSubs = !subsOnly || i.subscribed;
        return matches && passSubs;
      }),
    }));
  }, [sections, query, subsOnly]);

  const markDirty = () => setDirty(true);

  function toggleSubscribe(sid: string, iid: string) {
    setSections((prev) =>
      prev.map((s) =>
        s.id !== sid
          ? s
          : {
              ...s,
              items: s.items.map((i) =>
                i.id !== iid
                  ? i
                  : i.subscribed
                  ? {
                      ...i,
                      subscribed: false,
                      channels: { email: false, sms: false },
                    }
                  : {
                      ...i,
                      subscribed: true,
                      channels: { email: true, sms: true },
                    }
              ),
            }
      )
    );
    markDirty();
  }

  function toggleChannel(sid: string, iid: string, ch: Channel) {
    setSections((prev) =>
      prev.map((s) =>
        s.id !== sid
          ? s
          : {
              ...s,
              items: s.items.map((i) =>
                i.id !== iid || !i.subscribed
                  ? i
                  : { ...i, channels: { ...i.channels, [ch]: !i.channels[ch] } }
              ),
            }
      )
    );
    markDirty();
  }

  function setAll(sid: string, v: boolean) {
    setSections((prev) =>
      prev.map((s) =>
        s.id !== sid
          ? s
          : {
              ...s,
              items: s.items.map((i) => ({
                ...i,
                subscribed: v,
                channels: v
                  ? { email: true, sms: true }
                  : { email: false, sms: false },
              })),
            }
      )
    );
    markDirty();
  }

  async function onSave() {
    const live = sections.find((s) => s.id === "live");
    const allItems = live?.items || [];
    const prefs = allItems
      .filter((i) => i.subscribed || i.recordId != null)
      .map((i) => ({
        id: i.id,
        recordId: i.recordId ?? undefined,
        subscribed: i.subscribed,
        email: i.channels.email,
        sms: i.channels.sms,
      }));
    const cid = Number(resolvedCustomerId);
    if (!cid || !Number.isFinite(cid)) {
      toast.error("Missing customerId");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/netsuite/save-event-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: cid,
          preferences: prefs,
        }),
      });
      const data = await r.json();
      if (!r.ok || data?.error) {
        throw new Error(data?.error || "Failed to save");
      }
      toast.success("Preferences saved.");
      setDirty(false);
      await loadSubscriptions(cid);
    } catch (e: any) {
      toast.error(e?.message || "Failed to save preferences.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-28 pt-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Notification Preferences
          </h1>
          <p className="text-sm text-slate-600">
            Manage subscriptions and delivery channels.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
            <Bell className="h-4 w-4 text-slate-500" />
            <span className="font-semibold">{totals.sub}</span>
            <span className="text-slate-400">/ {totals.all} subscribed</span>
          </div>
          <button
            onClick={async () => {
              await loadEventTypes();
              const cid = Number(resolvedCustomerId);
              if (cid && Number.isFinite(cid)) await loadSubscriptions(cid);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            disabled={loadingEvents}
          >
            <RefreshCw
              className={`h-4 w-4 ${loadingEvents ? "animate-spin" : ""}`}
            />
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
              placeholder="Search by name or description…"
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
        </div>
      </div>

      <div className="space-y-8">
        {filtered.map((section) => (
          <section
            key={section.id}
            id={section.id}
            className="rounded-xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="flex flex-col gap-1 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {section.title}
                </h2>
                {section.subtitle && (
                  <p className="text-sm text-slate-600">{section.subtitle}</p>
                )}
              </div>
              <div className="mt-2 flex gap-2 sm:mt-0">
                <button
                  onClick={() => setAll(section.id, true)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Select All
                </button>
                <button
                  onClick={() => setAll(section.id, false)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Clear All
                </button>
              </div>
            </div>

            <ul className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {section.items.length === 0 && (
                <li className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
                  No items match your filters.
                </li>
              )}
              {section.items.map((i) => (
                <ItemCard
                  key={i.id}
                  sectionId={section.id}
                  item={i}
                  onToggleSubscribe={toggleSubscribe}
                  onToggleChannel={toggleChannel}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

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
    </div>
  );
}
