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

const DEMO_EVENTS: VipEvent[] = [
  // {
  //   id: "evt_mon_rock",
  //   name: "Monday Night Live — Rough Rock Sale",
  //   startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  //   description:
  //     "Hand-picked rough for slabs, spheres, and cabbing. Early access pricing.",
  //   zoomJoinUrl: "https://zoom.us/j/1234567890",
  //   category: "rough_rock",
  // },
  // {
  //   id: "evt_tools",
  //   name: "All Machines — Lapidary Tools Live",
  //   startsAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  //   description:
  //     "Saws, polishers, belts & accessories. Live Q&A with the tech team.",
  //   zoomJoinUrl: "https://zoom.us/j/0987654321",
  //   category: "machines",
  // },
  // {
  //   id: "evt_agate",
  //   name: "Agate Collectors Community",
  //   startsAt: new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString(),
  //   description: "Show & tell, ID tips, swaps, and exclusive agate drops.",
  //   zoomJoinUrl: "https://zoom.us/j/111222333",
  //   category: "agate",
  // },
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
  const y1 = useTransform(scrollYProgress, [0, 1], [0, -30]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, -60]);

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
        <div className="absolute inset-0 bg-[radial-gradient(120%_140%_at_50%_-20%,#FFFFEC,transparent_60%),linear-gradient(180deg,#FFFFFF_0%,#FFFFEC_50%,#FFFFFF_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(60%_40%_at_20%_10%,rgba(140,15,15,0.06),transparent_60%),radial-gradient(40%_30%_at_90%_20%,rgba(224,28,36,0.05),transparent_60%)]" />
      </div>

      {/* WELCOME BANNER */}
      <section
        ref={heroRef}
        className="relative overflow-hidden rounded-3xl border border-[#BFBFBF] shadow-2xl"
      >
        <div className="absolute inset-0 z-0 bg-[linear-gradient(180deg,#17152A_0%,#1B1730_60%,#211C36_100%)]" />
        <motion.div style={{ y: y1 }} className="absolute inset-x-0 -top-20">
          <div className="mx-auto h-[260px] w-[72%] rounded-[100%] bg-[#8C0F0F]/30 blur-[90px]" />
        </motion.div>
        <motion.div style={{ y: y2 }} className="absolute inset-x-0 -top-6">
          <div className="mx-auto h-[220px] w-[66%] rounded-[100%] bg-[#E01C24]/20 blur-[90px]" />
        </motion.div>

        <div className="relative z-10 grid gap-2 p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <img
              src="/HPL_logo.png"
              alt="HPL logo"
              className="h-9 w-9 rounded-full ring-2 ring-white/20 object-contain"
            />
            <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/85 backdrop-blur">
              Welcome
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
            Welcome back!
          </h2>
          <p className="text-sm text-white/85">
            Your VIP entrances show up below. Join directly when it's time.
          </p>
          <div className="mt-3 h-[3px] w-24 rounded-full bg-gradient-to-r from-[#8C0F0F] to-[#E01C24]" />
        </div>
      </section>

      {/* Carousel  */}
      <section className="relative">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium tracking-wide text-[#17152A]">
            Your VIP Events
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => scrollBy(-1)}
              aria-label="Previous"
              className="inline-flex items-center justify-center rounded-full border border-[#BFBFBF] bg-white px-3.5 py-3 text-[#17152A] transition-colors hover:bg-[#8C0F0F] hover:text-white"
            >
              <ArrowRight className="h-4 w-4 rotate-180" />
            </button>
            <button
              onClick={() => scrollBy(1)}
              aria-label="Next"
              className="inline-flex items-center justify-center rounded-full border border-[#BFBFBF] bg-white px-3.5 py-3 text-[#17152A] transition-colors hover:bg-[#8C0F0F] hover:text-white"
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
                <div className="relative isolate rounded-3xl border border-[#BFBFBF] bg-[#FFFFEC] p-12 text-center overflow-hidden">
                  <div className="relative z-[1] max-w-xl mx-auto">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#BFBFBF] px-4 py-1 text-xs text-[#17152A] bg-white/60">
                      <Sparkles className="h-3.5 w-3.5 text-[#8C0F0F]" />
                      VIP Room
                    </div>
                    <h3 className="mt-4 text-2xl sm:text-3xl font-semibold text-[#17152A]">
                      No upcoming events yet
                    </h3>
                    <p className="mt-2 text-[#17152A]/70">
                      (Coming Soon) When you're subscribed to events, your
                      personal VIP join banners will show up here.
                    </p>
                    {error && (
                      <p className="mt-4 text-[12px] text-[#8C0F0F]">{error}</p>
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
