"use client";

import { useCustomerBootstrap } from "@/components/providers/CustomerBootstrap";
import {
  fetchLiveEvents,
  getEventTypes,
  isEventCurrentlyLive,
  joinLiveSession,
  type LiveEvent,
} from "@/lib/actions/livesaleapp";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  TextField,
  Typography,
} from "@mui/material";
import { createBrowserClient } from "@supabase/ssr";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Clock, PlayCircle, Sparkles, UserCog } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type VipEvent = {
  id: string;
  name: string;
  startsAt?: string;
  description: string;
  zoomJoinUrl: string;
  category?: "rough_rock" | "machines" | "agate" | "other";
};

type ImageRule = { pattern: RegExp; src: string };

const IMG_BASE = "/assets/events";

const IMAGE_MAP_EXACT: Record<string, string> = {
  cut_and_chat_live_event: `${IMG_BASE}/cut_and_chat_live_event.png`,
  friday_rough_rock_event: `${IMG_BASE}/friday_rough_rock_event.png`,
  mineral_live_event: `${IMG_BASE}/mineral_live_event.png`,
  monday_live_event: `${IMG_BASE}/monday_live_event.png`,
  saturday_slab_event: `${IMG_BASE}/saturday_slab_event.png`,
  sphere_collectors_event: `${IMG_BASE}/sphere_collectors_event.png`,
  thursday_afternoon_live_event: `${IMG_BASE}/thursday_afternoon_live_event.png`,
  wednesday_rough_rock_event: `${IMG_BASE}/wednesday_rough_rock_event.png`,
};

const IMAGE_FALLBACK_BY_KEYWORD: ImageRule[] = [
  {
    pattern: /rough|slab|rock/i,
    src: `${IMG_BASE}/Wednesday_Friday_Saturday_Rough_Rock.png`,
  },
  {
    pattern: /machine|tool/i,
    src: `${IMG_BASE}/Machine_Night_special_event.png`,
  },
  {
    pattern: /chat|cabochon|thursday/i,
    src: `${IMG_BASE}/Thursday_Cabochon_afternoon.png`,
  },
];

function resolveEventImage(opts: {
  internalName: string;
  category?: VipEvent["category"];
}): string | null {
  const key = opts.internalName.trim().toLowerCase();
  if (IMAGE_MAP_EXACT[key]) return IMAGE_MAP_EXACT[key];
  for (const rule of IMAGE_FALLBACK_BY_KEYWORD) {
    if (rule.pattern.test(key)) return rule.src;
  }
  if (opts.category === "rough_rock")
    return "/events/Wednesday_Friday_Saturday_Rough_Rock.png";
  if (opts.category === "machines")
    return "/events/Machine_Night_special_event.png";
  return null;
}

function whenText(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "TBA";
  const now = Date.now();
  const diffMs = d.getTime() - now;
  const minsAbs = Math.round(Math.abs(diffMs) / 60000);

  if (diffMs > 0) {
    if (minsAbs < 60) return `in ${minsAbs}m`;
    const h = Math.floor(minsAbs / 60);
    const m = minsAbs % 60;
    return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
  } else {
    if (minsAbs < 60) return `${minsAbs}m ago`;
    const hours = Math.round(minsAbs / 60);
    return `${hours}h ago`;
  }
}

function categoryPill(c?: VipEvent["category"]) {
  switch (c) {
    case "rough_rock":
      return { label: "Rough Rock", className: "bg-[#FFF2F2] text-[#8C0F0F]" };
    case "machines":
      return { label: "Machines", className: "bg-[#F2F7FF] text-[#0F3D8C]" };
    case "agate":
      return { label: "Agate", className: "bg-[#F7FFF2] text-[#2D6A00]" };
    default:
      return { label: "VIP", className: "bg-white/70 text-[#17152A]" };
  }
}

function parseISO(s?: string) {
  if (!s) return new Date(NaN);
  const hasTZ = /Z|[+-]\d{2}:\d{2}$/.test(s);
  return new Date(hasTZ ? s : s + "Z");
}

function classify(event?: LiveEvent) {
  if (!event)
    return {
      isLive: false,
      badge: "Not live",
      timeText: "TBA",
      sortKey: 3,
      startsAt: undefined as string | undefined,
    };

  const now = Date.now();
  const start = parseISO(event.startTime).getTime();
  const end = event.endTime
    ? parseISO(event.endTime).getTime()
    : start + 3 * 60 * 60 * 1000;

  if (now >= start && now <= end) {
    const mins = Math.max(0, Math.round((now - start) / 60000));
    return {
      isLive: true,
      badge: "Live now",
      timeText:
        mins < 60
          ? `started ${mins}m ago`
          : `started ${Math.round(mins / 60)}h ago`,
      sortKey: 0,
      startsAt: event.startTime,
    };
  }

  if (now < start) {
    const mins = Math.round((start - now) / 60000);
    let timeText: string;
    if (mins < 60) {
      timeText = `in ${mins}m`;
    } else {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      timeText = m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
    }
    return {
      isLive: false,
      badge: "Upcoming",
      timeText,
      sortKey: 1,
      startsAt: event.startTime,
    };
  }

  const mins = Math.round((now - end) / 60000);
  return {
    isLive: false,
    badge: "Ended",
    timeText: mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`,
    sortKey: 2,
    startsAt: event.startTime,
  };
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

export default function Dashboard() {
  const router = useRouter();
  const { hsId } = useCustomerBootstrap();

  const [events, setEvents] = useState<
    | (VipEvent & {
        _live?: {
          isLive: boolean;
          badge: string;
          timeText: string;
          sortKey: number;
        };
      })[]
    | null
  >(null);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingEventId, setLoadingEventId] = useState<string | null>(null);

  const [showProfileUpdateDialog, setShowProfileUpdateDialog] = useState(false);
  const [formFirstName, setFormFirstName] = useState("");
  const [formMiddleName, setFormMiddleName] = useState("");
  const [formLastName, setFormLastName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [authEmail, setAuthEmail] = useState<string>("");
  const [authFirstName, setAuthFirstName] = useState<string>("");
  const [authMiddleName, setAuthMiddleName] = useState<string>("");
  const [authLastName, setAuthLastName] = useState<string>("");

  const [pageLoading, setPageLoading] = useState<boolean>(true);
  const [loaderLabel, setLoaderLabel] = useState<string>("Cutting your rock…");
  const [loaderProgress, setLoaderProgress] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const u = data.user;
        if (u) {
          const meta = (u.user_metadata as any) || {};
          setAuthEmail(u.email || "");
          setAuthFirstName((meta.first_name || "").toString().trim());
          setAuthMiddleName((meta.middle_name || "").toString().trim());
          setAuthLastName((meta.last_name || "").toString().trim());
        }
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const alive = true;
    (async () => {
      try {
        setLoaderLabel("Cutting your rock…");
        setLoaderProgress(12);
        const [eventTypes, liveEventsData] = await Promise.all([
          getEventTypes(),
          fetchLiveEvents(),
        ]);
        if (!alive) return;

        setLoaderProgress(62);
        setLiveEvents(liveEventsData);

        const list = eventTypes
          .map((eventType) => {
            const matches = liveEventsData.filter(
              (le) => le.type === eventType.internalName
            );
            let chosen = matches.find((e) => {
              const now = Date.now();
              const hasTZS = /Z|[+-]\d{2}:\d{2}$/.test(e.startTime || "");
              const s = new Date(
                hasTZS ? e.startTime : (e.startTime || "") + "Z"
              ).getTime();
              const eHasTZ = e.endTime
                ? /Z|[+-]\d{2}:\d{2}$/.test(e.endTime)
                : true;
              const end = e.endTime
                ? new Date(eHasTZ ? e.endTime : e.endTime + "Z").getTime()
                : s + 3 * 60 * 60 * 1000;
              return now >= s && now <= end;
            });
            if (!chosen && matches.length > 0) {
              chosen = matches.slice().sort((a, b) => {
                const az = /Z|[+-]\d{2}:\d{2}$/.test(a.startTime || "");
                const bz = /Z|[+-]\d{2}:\d{2}$/.test(b.startTime || "");
                return (
                  new Date(
                    (bz ? "" : "") + (b.startTime || "") + (bz ? "" : "Z")
                  ).getTime() -
                  new Date(
                    (az ? "" : "") + (a.startTime || "") + (az ? "" : "Z")
                  ).getTime()
                );
              })[0];
            }
            const now = Date.now();
            let sortKey = 99;
            let badge = "Not live";
            let timeText = "TBA";
            if (chosen) {
              const hasTZS = /Z|[+-]\d{2}:\d{2}$/.test(chosen.startTime || "");
              const s = new Date(
                hasTZS ? chosen.startTime : (chosen.startTime || "") + "Z"
              ).getTime();
              const eHasTZ = chosen.endTime
                ? /Z|[+-]\d{2}:\d{2}$/.test(chosen.endTime)
                : true;
              const end = chosen.endTime
                ? new Date(
                    eHasTZ ? chosen.endTime : chosen.endTime + "Z"
                  ).getTime()
                : s + 3 * 60 * 60 * 1000;
              if (now >= s && now <= end) {
                const mins = Math.max(0, Math.round((now - s) / 60000));
                badge = "Live now";
                timeText =
                  mins < 60
                    ? `started ${mins}m ago`
                    : `started ${Math.round(mins / 60)}h ago`;
                sortKey = 0;
              } else if (now < s) {
                const mins = Math.max(0, Math.round((s - now) / 60000));
                badge = "Upcoming";
                if (mins < 60) {
                  timeText = `in ${mins}m`;
                } else {
                  const h = Math.floor(mins / 60);
                  const m = mins % 60;
                  timeText = m ? `in ${h}h ${m}m` : `in ${h}h`;
                }
                sortKey = 1;
              } else {
                const mins = Math.round((now - end) / 60000);
                badge = "Ended";
                timeText =
                  mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
                sortKey = 2;
              }
            }
            let category: VipEvent["category"] = "other";
            if (
              eventType.internalName.includes("rough_rock") ||
              eventType.internalName.includes("rough") ||
              eventType.internalName.includes("slab")
            ) {
              category = "rough_rock";
            } else if (
              eventType.internalName.includes("machine") ||
              eventType.internalName.includes("tool")
            ) {
              category = "machines";
            } else if (eventType.internalName.includes("agate")) {
              category = "agate";
            }
            const record = {
              id: eventType.internalName,
              name: eventType.label,
              startsAt: chosen?.startTime,
              description: eventType.description,
              zoomJoinUrl: "#",
              category,
              _live: { isLive: sortKey === 0, badge, timeText, sortKey },
            };
            return record;
          })
          .sort((a, b) => {
            const ak = a._live?.sortKey ?? 99;
            const bk = b._live?.sortKey ?? 99;
            if (ak !== bk) return ak - bk;
            const at = a.startsAt
              ? new Date(
                  /Z|[+-]\d{2}:\d{2}$/.test(a.startsAt)
                    ? a.startsAt
                    : a.startsAt + "Z"
                ).getTime()
              : 0;
            const bt = b.startsAt
              ? new Date(
                  /Z|[+-]\d{2}:\d{2}$/.test(b.startsAt)
                    ? b.startsAt
                    : b.startsAt + "Z"
                ).getTime()
              : 0;
            return bt - at;
          });

        setLoaderProgress(88);
        setEvents(list);
      } catch (e) {
        const errorMessage =
          e instanceof Error ? e.message : "Failed to load events";
        setError(errorMessage);
        setEvents([]);
      } finally {
        setLoaderProgress(100);
        setTimeout(() => {
          setPageLoading(false);
          setLoaderProgress(null);
        }, 250);
      }
    })();
    return () => {};
  }, []);

  useEffect(() => {
    if (!hsId) return;
    (async () => {
      try {
        await fetch(`/api/hubspot/contact?contactId=${hsId}`, {
          cache: "no-store",
        });
      } catch {}
    })();
  }, [hsId]);

  async function ensureNames(): Promise<{
    firstName: string;
    lastName: string;
    middleName?: string;
  } | null> {
    const fn = authFirstName.trim();
    const ln = authLastName.trim();
    if (fn && ln)
      return {
        firstName: fn,
        lastName: ln,
        middleName: authMiddleName.trim() || undefined,
      };
    setFormFirstName(fn);
    setFormMiddleName(authMiddleName.trim());
    setFormLastName(ln);
    setShowProfileUpdateDialog(true);
    return null;
  }

  async function saveNamesAndProceed(targetEventId: string) {
    try {
      setSavingProfile(true);
      const firstName = formFirstName.trim();
      const lastName = formLastName.trim();
      const middleName = formMiddleName.trim();
      if (!firstName || !lastName) {
        toast.error("Please enter your first and last name.");
        return;
      }
      const { error: updErr } = await supabase.auth.updateUser({
        data: {
          first_name: firstName,
          middle_name: middleName || undefined,
          last_name: lastName,
        },
      });
      if (updErr) {
        toast.error(updErr.message || "Could not update your profile.");
        return;
      }
      setAuthFirstName(firstName);
      setAuthMiddleName(middleName);
      setAuthLastName(lastName);
      setShowProfileUpdateDialog(false);

      const matchingLiveEvents = liveEvents.filter(
        (le) => le.type === targetEventId
      );
      if (matchingLiveEvents.length === 0) {
        toast.error("No live events found for this event type");
        return;
      }
      const latestEvent = matchingLiveEvents.sort(
        (a, b) =>
          new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
      )[0];
      // if (latestEvent.isEnded) {
      //   toast.error("This event has already ended.");
      //   return;
      // }
      // if (!latestEvent.startTime) {
      //   toast.error("This event has no start time.");
      //   return;
      // }
      // if (Date.now() < new Date(latestEvent.startTime).getTime()) {
      //   toast.error("This event has not started yet.");
      //   return;
      // }
      const isJoinable = await isEventCurrentlyLive(latestEvent);
      if (!isJoinable) {
        toast.error(
          "This event is not currently available to join. Please check back within 30 minutes of the event time."
        );
        return;
      }
      const reg = await joinLiveSession(latestEvent.id, {
        email: authEmail,
        firstName,
        lastName,
      });
      if (reg.success && reg.joinUrl) {
        window.open(reg.joinUrl, "_blank");
      } else {
        throw new Error(reg.message || "Failed to get join URL");
      }
    } catch (e) {
      toast.error(
        `Failed to join session: ${
          e instanceof Error ? e.message : "Unknown error"
        }`
      );
    } finally {
      setSavingProfile(false);
      setLoadingEventId(null);
      setLoaderLabel("Cutting your rock…");
    }
  }

  return (
    <div className="relative space-y-7">
      <div className="pointer-events-none absolute inset-0 -z-10 rounded-xl">
        <div className="absolute inset-0 bg-[radial-gradient(120%_140%_at_50%_-20%,#FFFFEC,transparent_60%),linear-gradient(180deg,#FFFFFF_0%,#FFFFEC_50%,#FFFFFF_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(60%_40%_at_20%_10%,rgba(140,15,15,0.06),transparent_60%),radial-gradient(40%_30%_at_90%_20%,rgba(224,28,36,0.05),transparent_60%)]" />
      </div>

      <header className="mb-0.5">
        <h1 className="text-[20px] font-bold text-[#17152A]">
          Your VIP Events
        </h1>
        <div className="mt-2 h-0.5 w-14 rounded-full bg-gradient-to-r from-[#8C0F0F] to-[#E01C24]" />
      </header>

      <section>
        <div className="grid grid-cols-1 gap-3.5">
          <AnimatePresence initial={false}>
            {!events &&
              Array.from({ length: 3 }).map((_, i) => (
                <CardSkeleton key={`sk-${i}`} />
              ))}

            {events?.map((e) => {
              const pill = categoryPill(e.category);
              const src = resolveEventImage({
                internalName: e.id,
                category: e.category,
              });
              const liveMeta = e._live;
              return (
                <motion.article
                  key={e.id}
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
                          alt={e.name}
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
                          {e.name}
                        </h4>
                        <p className="mt-1 text-[13.5px] leading-5 text-[#17152A]/70">
                          {e.description}
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
                              : e.startsAt
                              ? whenText(e.startsAt)
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
                            loadingEventId === e.id
                              ? "Joining..."
                              : "Join live session"
                          }
                          onClick={async () => {
                            try {
                              if (!authEmail) {
                                toast.error("User email not found.");
                                return;
                              }
                              setLoadingEventId(e.id);
                              setLoaderLabel("Joining live session…");
                              const names = await ensureNames();
                              if (!names) return;
                              const matchingLiveEvents = liveEvents.filter(
                                (le) => le.type === e.id
                              );
                              if (matchingLiveEvents.length === 0)
                                throw new Error(
                                  "No live events found for this event type"
                                );
                              const latestEvent = matchingLiveEvents.sort(
                                (a, b) =>
                                  new Date(b.startTime).getTime() -
                                  new Date(a.startTime).getTime()
                              )[0];
                              // if (latestEvent.isEnded) {
                              //   toast.error("This event has already ended.");
                              //   return;
                              // }
                              // if (!latestEvent.startTime) {
                              //   toast.error("This event has no start time.");
                              //   return;
                              // }
                              // if (Date.now() < new Date(latestEvent.startTime).getTime()) {
                              //   toast.error("This event has not started yet.");
                              //   return;
                              // }
                              const isJoinable = await isEventCurrentlyLive(
                                latestEvent
                              );
                              if (!isJoinable) {
                                toast.error(
                                  "This event is not currently available to join. Please check back within 30 minutes of the event time."
                                );
                                return;
                              }
                              const result = await joinLiveSession(
                                latestEvent.id,
                                {
                                  email: authEmail,
                                  firstName: names.firstName,
                                  lastName: names.lastName,
                                }
                              );
                              if (result.success && result.joinUrl) {
                                window.open(result.joinUrl, "_blank");
                              } else {
                                throw new Error(
                                  result.message || "Failed to get join URL"
                                );
                              }
                            } catch (error) {
                              toast.error(
                                `Failed to join session: ${
                                  error instanceof Error
                                    ? error.message
                                    : "Unknown error"
                                }`
                              );
                            } finally {
                              setLoadingEventId(null);
                              setLoaderLabel("Cutting your rock…");
                            }
                          }}
                          disabled={loadingEventId === e.id}
                          className={`cursor-pointer inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-[13.5px] font-medium text-white transition-all ${
                            loadingEventId === e.id
                              ? "bg-gray-400 pointer-events-none"
                              : "bg-[#17152A] hover:bg-[#8C0F0F] active:scale-98"
                          }`}
                        >
                          {loadingEventId === e.id ? (
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
            })}

            {events && events.length === 0 && (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="relative overflow-hidden rounded-2xl border border-[#BFBFBF] bg-[#FFFFEC] p-8 text-center"
              >
                <div className="inline-flex items-center gap-2 rounded-full border border-[#BFBFBF] bg-white/60 px-3.5 py-0.5 text-xs text-[#17152A]">
                  <Sparkles className="h-3.5 w-3.5 text-[#8C0F0F]" />
                  VIP Room
                </div>
                <h3 className="mt-3.5 text-[22px] sm:text-[26px] font-semibold text-[#17152A]">
                  (Coming Soon) No upcoming events yet
                </h3>
                <p className="mt-1.5 text-[#17152A]/70">
                  Subscribe to events and your personal VIP join banners will
                  appear here.
                </p>
                {error && (
                  <p className="mt-3 text-[12px] text-[#8C0F0F]">{error}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <Dialog
        open={showProfileUpdateDialog}
        onClose={() => setShowProfileUpdateDialog(false)}
        aria-labelledby="profile-update-dialog-title"
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
        <DialogTitle id="profile-update-dialog-title" sx={{ pb: 1 }}>
          <Box className="flex items-center gap-3">
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: "9999px",
                backgroundColor: "#fef3c7",
                display: "grid",
                placeItems: "center",
              }}
            >
              <UserCog className="h-4 w-4" color="#d97706" />
            </Box>
            <Box>
              <Typography sx={{ fontWeight: 700, fontSize: 18 }}>
                Profile Update Required
              </Typography>
              <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                To join the live session, please confirm your name.
              </Typography>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Box sx={{ display: "grid", gap: 1.5 }}>
            <TextField
              label="First name"
              size="small"
              value={formFirstName}
              onChange={(e) => setFormFirstName(e.target.value)}
              inputProps={{ maxLength: 80 }}
            />
            <TextField
              label="Middle name (optional)"
              size="small"
              value={formMiddleName}
              onChange={(e) => setFormMiddleName(e.target.value)}
              inputProps={{ maxLength: 80 }}
            />
            <TextField
              label="Last name"
              size="small"
              value={formLastName}
              onChange={(e) => setFormLastName(e.target.value)}
              inputProps={{ maxLength: 80 }}
            />
            <Box className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                We’ll save this to your account and won’t ask again.
              </Typography>
            </Box>
          </Box>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2, gap: 1.5 }}>
          <Button
            variant="outlined"
            onClick={() => setShowProfileUpdateDialog(false)}
            disabled={savingProfile}
            sx={{
              textTransform: "none",
              borderColor: "#d1d5db",
              color: "#6b7280",
              "&:hover": { borderColor: "#9ca3af", backgroundColor: "#f9fafb" },
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => saveNamesAndProceed(loadingEventId || "")}
            disabled={savingProfile}
            sx={{
              textTransform: "none",
              backgroundColor: "#17152A",
              "&:hover": { backgroundColor: "#8C0F0F" },
            }}
          >
            {savingProfile ? "Saving…" : "Save & Join"}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

// "use client";

// import React, { useEffect, useRef, useState } from "react";
// import Link from "next/link";
// import { AnimatePresence } from "framer-motion";
// import { Sparkles, ArrowRight } from "lucide-react";
// import VipCard, { VipEvent } from "@/components/UI/VipCard";

// const DEMO_EVENTS: VipEvent[] = [];

// export default function Dashboard() {
//   const [events, setEvents] = useState<VipEvent[] | null>(null);
//   const [error, setError] = useState<string | null>(null);
//   const scrollerRef = useRef<HTMLDivElement>(null);
//   const DEMO_EVENTS: VipEvent[] = [
//     // {
//     //   id: "evt_mon_rock",
//     //   name: "Monday Night Live — Rough Rock Sale",
//     //   startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
//     //   description:
//     //     "Hand-picked rough for slabs, spheres, and cabbing. Early access pricing.",
//     //   zoomJoinUrl: "https://zoom.us/j/1234567890",
//     //   category: "rough_rock",
//     // },
//     // {
//     //   id: "evt_tools",
//     //   name: "All Machines — Lapidary Tools Live",
//     //   startsAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
//     //   description:
//     //     "Saws, polishers, belts & accessories. Live Q&A with the tech team.",
//     //   zoomJoinUrl: "https://zoom.us/j/0987654321",
//     //   category: "machines",
//     // },
//     // {
//     //   id: "evt_agate",
//     //   name: "Agate Collectors Community",
//     //   startsAt: new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString(),
//     //   description: "Show & tell, ID tips, swaps, and exclusive agate drops.",
//     //   zoomJoinUrl: "https://zoom.us/j/111222333",
//     //   category: "agate",
//     // },
//   ];

//   useEffect(() => {
//     let alive = true;
//     (async () => {
//       try {
//         const res = await fetch("/api/get-customer-event-subscriptions", {
//           cache: "no-store",
//         });
//         if (!res.ok) throw new Error("");
//         const data = await res.json();
//         const list: VipEvent[] = (data?.events || data || []).map((x: any) => ({
//           id: String(x.id ?? x.eventId ?? Math.random().toString(36).slice(2)),
//           name: String(x.name ?? x.title ?? "VIP Session"),
//           startsAt: String(
//             x.startsAt ?? x.startDate ?? new Date().toISOString()
//           ),
//           description:
//             x.description ??
//             x.summary ??
//             "Exclusive live session for subscribers.",
//           zoomJoinUrl: String(x.zoomJoinUrl ?? x.zoomUrl ?? x.joinUrl ?? "#"),
//           category: x.category as VipEvent["category"],
//         }));
//         if (alive) setEvents(list);
//       } catch (e: any) {
//         if (alive) {
//           setError(e?.message || "");
//           setEvents(DEMO_EVENTS);
//         }
//       }
//     })();
//     return () => {
//       alive = false;
//     };
//   }, []);

//   const scrollBy = (dir: 1 | -1) => {
//     const el = scrollerRef.current;
//     if (!el) return;
//     const card = el.querySelector<HTMLElement>("article");
//     const dx = card ? card.clientWidth + 16 : 480;
//     el.scrollBy({ left: dir * dx, behavior: "smooth" });
//   };

//   return (
//     <div className="relative space-y-8">
//       <div className="pointer-events-none absolute inset-0 -z-10 rounded-xl">
//         <div className="absolute inset-0 bg-[radial-gradient(120%_140%_at_50%_-20%,#FFFFEC,transparent_60%),linear-gradient(180deg,#FFFFFF_0%,#FFFFEC_50%,#FFFFFF_100%)]" />
//         <div className="absolute inset-0 bg-[radial-gradient(60%_40%_at_20%_10%,rgba(140,15,15,0.06),transparent_60%),radial-gradient(40%_30%_at_90%_20%,rgba(224,28,36,0.05),transparent_60%)]" />
//       </div>

//       <header className="mb-2">
//         <h1 className="text-2xl font-bold text-[#17152A]">Welcome!</h1>
//         <div className="mt-2 h-0.5 w-16 rounded-full bg-gradient-to-r from-[#8C0F0F] to-[#E01C24]" />
//       </header>

//       <section className="relative">
//         <div className="mb-3 flex items-center justify-between">
//           <h3 className="text-sm font-medium tracking-wide text-[#17152A]">
//             Your VIP Events
//           </h3>
//           <div className="flex items-center gap-2">
//             {/* <button
//               onClick={() => scrollBy(-1)}
//               aria-label="Previous"
//               className="inline-flex items-center justify-center rounded-full border border-[#BFBFBF] bg-white px-3.5 py-3 text-[#17152A] transition-colors hover:bg-[#8C0F0F] hover:text-white"
//             >
//               <ArrowRight className="h-4 w-4 rotate-180" />
//             </button>
//             <button
//               onClick={() => scrollBy(1)}
//               aria-label="Next"
//               className="inline-flex items-center justify-center rounded-full border border-[#BFBFBF] bg-white px-3.5 py-3 text-[#17152A] transition-colors hover:bg-[#8C0F0F] hover:text-white"
//             >
//               <ArrowRight className="h-4 w-4" />
//             </button> */}
//           </div>
//         </div>

//         <div
//           ref={scrollerRef}
//           className="scrollbar-none relative flex snap-x snap-mandatory gap-4 overflow-x-auto rounded-3xl p-1"
//         >
//           <AnimatePresence initial={false}>
//             {events && events.length > 0 ? (
//               events.map((e) => <VipCard key={e.id} event={e} />)
//             ) : (
//               <div className="w-full">
//                 <div className="relative isolate rounded-3xl border border-[#BFBFBF] bg-[#FFFFEC] p-12 text-center overflow-hidden">
//                   <div className="relative z-[1] mx-auto max-w-xl">
//                     <div className="inline-flex items-center gap-2 rounded-full border border-[#BFBFBF] bg-white/60 px-4 py-1 text-xs text-[#17152A]">
//                       <Sparkles className="h-3.5 w-3.5 text-[#8C0F0F]" />
//                       VIP Room
//                     </div>
//                     <h3 className="mt-4 text-2xl sm:text-3xl font-semibold text-[#17152A]">
//                       (Coming Soon) No upcoming events yet
//                     </h3>
//                     <p className="mt-2 text-[#17152A]/70">
//                       (Coming Soon) When you're subscribed to events, your
//                       personal VIP join banners will show up here.
//                     </p>
//                     {error && (
//                       <p className="mt-4 text-[12px] text-[#8C0F0F]">{error}</p>
//                     )}
//                   </div>
//                 </div>
//               </div>
//             )}
//           </AnimatePresence>
//         </div>
//       </section>
//     </div>
//   );
// }
