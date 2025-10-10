// src/components/VipCard.tsx
"use client";

import React from "react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import {
  CalendarDays,
  Clock,
  Video,
  Sparkles,
  ExternalLink,
  Hammer,
  Cog,
  Gem,
} from "lucide-react";
import { useBilling } from "@/components/providers/BillingProvider";
import { usePaymentMethods } from "@/components/providers/PaymentMethodsProvider";
import { toast } from "react-toastify";
import { useRouter } from "next/navigation";

export type VipEvent = {
  id: string;
  name: string;
  startsAt: string;
  description?: string;
  zoomJoinUrl: string;
  category?: "rough_rock" | "machines" | "agate" | "community";
};

type VipCardProps = {
  event: VipEvent;
  onJoinClick?: (e: VipEvent) => void;
  className?: string;
};

function isLiveWindow(iso: string) {
  const start = new Date(iso).getTime();
  const now = Date.now();
  return Math.abs(start - now) <= 10 * 60 * 1000;
}
function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
function hueFrom(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}
function bannerBackground(name: string, category?: VipEvent["category"]) {
  const baseHue = hueFrom(name);
  const shift =
    category === "rough_rock"
      ? -20
      : category === "machines"
      ? 25
      : category === "agate"
      ? 60
      : 0;
  const h1 = (baseHue + shift + 360) % 360;
  const h2 = (baseHue + shift + 40 + 360) % 360;
  const h3 = (baseHue + shift + 80 + 360) % 360;
  return {
    backgroundImage: `
      radial-gradient(120% 160% at 0% 0%, hsla(${h1} 90% 60% / .32), transparent 55%),
      radial-gradient(160% 120% at 100% 0%, hsla(${h2} 85% 62% / .28), transparent 55%),
      radial-gradient(140% 120% at 0% 100%, hsla(${h3} 80% 58% / .25), transparent 55%)
    `,
  } as React.CSSProperties;
}

function CategoryChip({ cat }: { cat?: VipEvent["category"] }) {
  const label =
    cat === "rough_rock"
      ? "Rough Rock"
      : cat === "machines"
      ? "Machines"
      : cat === "agate"
      ? "Agate"
      : "Community";
  const Icon =
    cat === "rough_rock"
      ? Hammer
      : cat === "machines"
      ? Cog
      : cat === "agate"
      ? Gem
      : Sparkles;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-2.5 py-1 text-[11px] text-white/85 ring-1 ring-white/20">
      <Icon className="h-[14px] w-[14px]" />
      {label}
    </span>
  );
}

export default function VipCard({
  event,
  onJoinClick,
  className,
}: VipCardProps) {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rX = useTransform(my, [-30, 30], [6, -6]);
  const rY = useTransform(mx, [-30, 30], [-6, 6]);
  const scale = useTransform(mx, [-40, 0, 40], [1.0, 1.02, 1.0]);

  const router = useRouter();
  const { unpaidInvoices, loading, allowLiveEventOverride, overrideLoading } =
    useBilling();
  const { loading: pmLoading, hasCardOnFile } = usePaymentMethods();

  const checking =
    loading || overrideLoading || allowLiveEventOverride === null || pmLoading;

  const handleJoin = () => {
    if (onJoinClick) {
      onJoinClick(event);
      return;
    }
    if (checking) {
      toast.info("Checking your account…");
      return;
    }
    if (!hasCardOnFile) {
      toast.warn("Please add a payment card to continue.");
      router.push("/payment");
      return;
    }
    if (allowLiveEventOverride === true) {
      window.open(event.zoomJoinUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (unpaidInvoices.length > 0) {
      toast.warn("You have unpaid invoices. Redirecting to settle them.");
      router.push(
        `/invoices?autopay=1&redirect=${encodeURIComponent(event.zoomJoinUrl)}`
      );
      return;
    }
    window.open(event.zoomJoinUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <motion.article
      onMouseMove={(ev) => {
        const rect = (
          ev.currentTarget as HTMLDivElement
        ).getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const midY = rect.top + rect.height / 2;
        mx.set(ev.clientX - midX);
        my.set(ev.clientY - midY);
      }}
      onMouseLeave={() => {
        mx.set(0);
        my.set(0);
      }}
      style={{ rotateX: rX, rotateY: rY, scale }}
      className={
        "relative group snap-center shrink-0 w-[88vw] sm:w-[520px] md:w-[620px] lg:w-[720px] rounded-3xl overflow-hidden border border-white/10 bg-slate-900/90 shadow-2xl " +
        (className || "")
      }
    >
      <div
        className="absolute inset-0"
        style={bannerBackground(event.name, event.category)}
      />
      <div className="absolute inset-0 backdrop-blur-[1px]" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-white/10 blur-[60px]" />
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-white/10 blur-[60px]" />
      <div className="relative z-[1] p-6 sm:p-8 md:p-10">
        <div className="flex flex-wrap items-center gap-3 text-sky-100">
          <span className="inline-flex items-center gap-2 text-sky-200/90">
            <Sparkles className="h-5 w-5" />
            <span className="text-[11px] tracking-[0.2em]">VIP ACCESS</span>
          </span>
          <CategoryChip cat={event.category} />
          {isLiveWindow(event.startsAt) && (
            <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-100 ring-1 ring-rose-300/30">
              Live now
            </span>
          )}
        </div>

        <h3 className="mt-3 text-2xl sm:text-3xl md:text-4xl font-semibold text-white">
          {event.name}
        </h3>

        <p className="mt-3 max-w-2xl text-sm text-white/85">
          {event.description || "Exclusive live session for subscribers."}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-4 text-white/90">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            <span className="text-sm">{formatDate(event.startsAt)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <span className="text-sm">Join when live</span>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            onClick={handleJoin}
            className="inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium bg-white text-slate-900 hover:bg-slate-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            disabled={checking}
          >
            <Video className="h-4 w-4" />
            {checking ? "Checking…" : "Join VIP Room"}
            <ExternalLink className="h-4 w-4" />
          </button>
        </div>
      </div>
    </motion.article>
  );
}
