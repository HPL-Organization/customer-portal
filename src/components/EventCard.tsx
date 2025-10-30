"use client";

import { categoryPill, resolveEventImage, type VipEvent, whenText } from "@/lib/utils/events";
import { motion } from "framer-motion";
import { ArrowRight, Clock, PlayCircle, Sparkles } from "lucide-react";
import Image from "next/image";

interface EventCardProps {
  event: VipEvent & {
    _live?: {
      isLive: boolean;
      badge: string;
      timeText: string;
      sortKey: number;
    };
  };
  onJoinClick: (eventId: string) => void;
  loadingEventId: string | null;
}

function CardSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#EAEAEA] bg-white">
      <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-[#8C0F0F] to-[#E01C24]" />
      <div className="animate-pulse">
        <div className="aspect-[16/7] w-full bg-neutral-100" />
        <div className="p-3.5 sm:p-4 space-y-2.5">
          <div className="h-4 w-24 rounded bg-neutral-100" />
          <div className="h-5 w-2/3 rounded bg-neutral-100" />
          <div className="h-4 w-11/12 rounded bg-neutral-100" />
          <div className="h-9 w-full rounded bg-neutral-100" />
        </div>
      </div>
    </div>
  );
}

export function EventCard({ event, onJoinClick, loadingEventId }: EventCardProps) {
  const pill = categoryPill(event.category);
  const src = resolveEventImage({
    internalName: event.id,
    category: event.category,
  });
  const liveMeta = event._live;

  return (
    <motion.article
      key={event.id}
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8 }}
      whileHover={{ y: -2 }}
      className="relative overflow-hidden rounded-2xl border border-[#EAEAEA] bg-white shadow-[0_6px_22px_rgba(0,0,0,0.06)]"
    >
      <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-[#8C0F0F] to-[#E01C24]" />
      <div className="relative">
        <div className="relative aspect-[16/7] w-full overflow-hidden bg-[#FFFFF4]">
          {src ? (
            <Image
              src={src}
              alt={event.name}
              fill
              sizes="100vw"
              className="object-cover"
              priority={false}
            />
          ) : (
            <div className="absolute inset-0 m-3.5 rounded-xl border-2 border-dashed border-[#E0E0CF] grid place-items-center">
              <span className="text-[11.5px] font-medium tracking-wide text-[#9A9985]">
                Image coming soon
              </span>
            </div>
          )}
        </div>
        <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-[#EFEFEF] bg-white/85 px-2.5 py-0.5 text-[11.5px] font-medium shadow-sm backdrop-blur">
          <Sparkles className="h-3.5 w-3.5 text-[#8C0F0F]" />
          <span
            className={
              pill.className + " rounded-full px-1.5 py-0.5"
            }
          >
            {pill.label}
          </span>
        </div>
        {liveMeta?.isLive && (
          <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-[#F7CACA] bg-[#FFF2F2] px-2.5 py-0.5 text-[11.5px] font-semibold text-[#8C0F0F] shadow-sm">
            Live now
          </div>
        )}
      </div>

      <div className="p-3.5 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h4 className="text-[15px] font-semibold text-[#17152A]">
              {event.name}
            </h4>
            <p className="mt-1 text-[13.5px] leading-5 text-[#17152A]/70">
              {event.description}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-[#17152A]">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${
                  liveMeta?.isLive
                    ? "bg-[#FFEFEF] border-[#F2D1D1]"
                    : "bg-[#FAFAF7] border-[#EFEFE5]"
                }`}
              >
                <Clock className="h-3.5 w-3.5" />
                {liveMeta
                  ? liveMeta.timeText
                  : event.startsAt
                  ? whenText(event.startsAt)
                  : "TBA"}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${
                  liveMeta?.isLive
                    ? "bg-[#FFF2F2] border-[#F7CACA] text-[#8C0F0F]"
                    : "bg-[#F0F4F8] border-[#E1E8F0] text-[#0F3D8C]/80"
                }`}
              >
                {liveMeta?.isLive ? "Live now" : "Not live"}
              </span>
            </div>
          </div>

          <div className="sm:pt-0.5 w-full sm:w-auto">
            <button
              title={
                loadingEventId === event.id
                  ? "Joining..."
                  : "Join live session"
              }
              onClick={() => onJoinClick(event.id)}
              disabled={loadingEventId === event.id}
              className={`cursor-pointer inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-[13.5px] font-medium text-white transition-all ${
                loadingEventId === event.id
                  ? "bg-gray-400 pointer-events-none"
                  : "bg-[#17152A] hover:bg-[#8C0F0F] active:scale-98"
              }`}
            >
              {loadingEventId === event.id ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Joining...
                </>
              ) : (
                <>
                  <PlayCircle className="h-4 w-4" />
                  Join live session
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

export { CardSkeleton };
