"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  motion,
  useTransform,
  AnimatePresence,
  useScroll,
} from "framer-motion";
import { Sparkles, ArrowRight } from "lucide-react";

import VipCard, { VipEvent } from "@/components/UI/VipCard";

/* ---------- Demo data ---------- */
const DEMO_EVENTS: VipEvent[] = [
  {
    id: "evt_mon_rock",
    name: "Monday Night Live — Rough Rock Sale",
    startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    description:
      "Hand-picked rough for slabs, spheres, and cabbing. Early access pricing.",
    zoomJoinUrl: "https://zoom.us/j/1234567890",
    category: "rough_rock",
  },
  {
    id: "evt_tools",
    name: "All Machines — Lapidary Tools Live",
    startsAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    description:
      "Saws, polishers, belts & accessories. Live Q&A with the tech team.",
    zoomJoinUrl: "https://zoom.us/j/0987654321",
    category: "machines",
  },
  {
    id: "evt_agate",
    name: "Agate Collectors Community",
    startsAt: new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString(),
    description: "Show & tell, ID tips, swaps, and exclusive agate drops.",
    zoomJoinUrl: "https://zoom.us/j/111222333",
    category: "agate",
  },
];

export default function Dashboard() {
  const [events, setEvents] = useState<VipEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end end"],
  });
  const y1 = useTransform(scrollYProgress, [0, 1], [0, -40]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, -80]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/get-customer-event-subscriptions", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Failed to load events");
        const data = await res.json();
        const list: VipEvent[] = (data?.events || data || []).map((x: any) => ({
          id: String(x.id ?? x.eventId ?? Math.random().toString(36).slice(2)),
          name: String(x.name ?? x.title ?? "VIP Session"),
          startsAt: String(
            x.startsAt ?? x.startDate ?? new Date().toISOString()
          ),
          description:
            x.description ??
            x.summary ??
            "Exclusive live session for subscribers.",
          zoomJoinUrl: String(x.zoomJoinUrl ?? x.zoomUrl ?? x.joinUrl ?? "#"),
          category: x.category as VipEvent["category"],
        }));
        if (alive) setEvents(list);
      } catch (e: any) {
        if (alive) {
          setError(e?.message || "Unable to fetch events");
          setEvents(DEMO_EVENTS);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("article");
    const dx = card ? card.clientWidth + 16 : 480;
    el.scrollBy({ left: dir * dx, behavior: "smooth" });
  };

  return (
    <div className="relative space-y-8">
      <div className="pointer-events-none absolute inset-0 -z-10 rounded-xl">
        <div className="absolute inset-0 bg-[radial-gradient(120%_140%_at_50%_-20%,#eaf1ff,transparent_60%),linear-gradient(180deg,#f7fafc_0%,#f5f8fb_60%,#f3f6fa_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(60%_40%_at_20%_10%,rgba(56,189,248,0.08),transparent_60%),radial-gradient(40%_30%_at_90%_20%,rgba(147,51,234,0.06),transparent_60%)]" />
        <div className="absolute inset-0 [mask-image:radial-gradient(70%_50%_at_50%_50%,black,transparent)] bg-[linear-gradient(0deg,rgba(0,0,0,0.05),transparent_40%)]" />
      </div>

      {/* HERO */}
      <section
        ref={heroRef}
        className="relative overflow-hidden rounded-3xl border border-slate-200 shadow-xl"
      >
        <div className="absolute inset-0 z-0 bg-[radial-gradient(80%_100%_at_50%_-20%,#0b1220,transparent_70%),linear-gradient(180deg,#0b1220_0%,#0a1222_40%,#0e1426_100%)]" />
        <motion.div
          style={{ y: y1 }}
          className="absolute inset-x-0 top-[-80px]"
        >
          <div className="mx-auto h-[280px] w-[75%] rounded-[100%] bg-sky-500/15 blur-[80px]" />
        </motion.div>
        <motion.div
          style={{ y: y2 }}
          className="absolute inset-x-0 top-[-20px]"
        >
          <div className="mx-auto h-[240px] w-[70%] rounded-[100%] bg-fuchsia-500/15 blur-[80px]" />
        </motion.div>
        <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-[1px]" />

        <div className="relative z-10 p-6 sm:p-8">
          <h2 className="text-2xl sm:text-3xl font-semibold text-white flex items-center gap-3">
            Welcome back!
          </h2>
          <p className="mt-2 text-sm text-slate-200/85">
            Your VIP entrances show up below. Join directly when it’s time.
          </p>
          <div className="pointer-events-none absolute right-6 top-6 flex gap-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-2 w-2 rounded-full bg-white/25 shadow-[0_0_12px_2px_rgba(255,255,255,0.25)]"
              />
            ))}
          </div>
        </div>
      </section>

      {/* Carousel */}
      <section className="relative">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium tracking-wide text-slate-800">
            Your VIP Events
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => scrollBy(-1)}
              aria-label="Previous"
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3.5 py-3 text-slate-800 hover:bg-slate-50 transition-colors"
            >
              <ArrowRight className="h-4 w-4 rotate-180" />
            </button>
            <button
              onClick={() => scrollBy(1)}
              aria-label="Next"
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3.5 py-3 text-slate-800 hover:bg-slate-50 transition-colors"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          ref={scrollerRef}
          className="scrollbar-none relative flex snap-x snap-mandatory gap-4 overflow-x-auto rounded-3xl p-1"
        >
          <AnimatePresence initial={false}>
            {events && events.length > 0 ? (
              events.map((e) => <VipCard key={e.id} event={e} />)
            ) : (
              <div className="w-full">
                <div className="relative isolate rounded-3xl border border-slate-200 bg-white p-12 text-center overflow-hidden">
                  <div className="relative z-[1] max-w-xl mx-auto">
                    <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-1 text-xs text-slate-600 bg-slate-50">
                      <Sparkles className="h-3.5 w-3.5" />
                      VIP Room
                    </div>
                    <h3 className="mt-4 text-2xl sm:text-3xl font-semibold text-slate-900">
                      No upcoming events yet
                    </h3>
                    <p className="mt-2 text-slate-600">
                      When you’re subscribed to events, your personal VIP join
                      banners will show up here.
                    </p>
                    {error && (
                      <p className="mt-4 text-[12px] text-rose-600">{error}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </section>
    </div>
  );
}
