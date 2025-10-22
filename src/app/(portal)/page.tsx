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
"use client";

import { useCustomerBootstrap } from "@/components/providers/CustomerBootstrap";
import { fetchLiveEvents, getEventTypes, isEventCurrentlyLive, joinLiveSession, type LiveEvent } from "@/lib/actions/livesaleapp";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Typography,
} from "@mui/material";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Clock, PlayCircle, Sparkles, UserCog, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";

type VipEvent = {
  id: string;
  name: string;
  startsAt?: string;
  description: string;
  zoomJoinUrl: string;
  category?: "rough_rock" | "machines" | "agate" | "other";
};

const DEMO_EVENTS: VipEvent[] = [
  {
    id: "evt_demo_1",
    name: "Monday Night Live — Rough Rock Sale",
    startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    description: "Hand-picked rough for slabs, spheres, and cabbing.",
    zoomJoinUrl: "#",
    category: "rough_rock",
  },
  {
    id: "evt_demo_2",
    name: "All Machines — Lapidary Tools Live",
    startsAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    description: "Saws, polishers, belts & accessories. Live Q&A.",
    zoomJoinUrl: "#",
    category: "machines",
  },
  {
    id: "evt_demo_3",
    name: "Agate Collectors Community",
    startsAt: new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString(),
    description: "Show & tell, ID tips, swaps, and exclusive drops.",
    zoomJoinUrl: "#",
    category: "agate",
  },
];

function whenText(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "TBA";
  const now = Date.now();
  const diff = d.getTime() - now;
  const mins = Math.round(Math.abs(diff) / 60000);
  if (mins < 60) return diff > 0 ? `in ${mins}m` : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return diff > 0 ? `in ${hours}h` : `${hours}h ago`;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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

function CardSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#EAEAEA] bg-white">
      <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-[#8C0F0F] to-[#E01C24]" />
      <div className="animate-pulse">
        <div className="aspect-[16/9] w-full bg-neutral-100" />
        <div className="p-4 space-y-3">
          <div className="h-4 w-24 rounded bg-neutral-100" />
          <div className="h-6 w-2/3 rounded bg-neutral-100" />
          <div className="h-4 w-11/12 rounded bg-neutral-100" />
          <div className="h-10 w-full rounded bg-neutral-100" />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const { hsId } = useCustomerBootstrap();
  const [events, setEvents] = useState<VipEvent[] | null>(null);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingEventId, setLoadingEventId] = useState<string | null>(null);
  const [showProfileUpdateDialog, setShowProfileUpdateDialog] = useState(false);
  const [hubspotContact, setHubspotContact] = useState<{
    firstname?: string;
    lastname?: string;
    email?: string;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Fetch event types and live events in parallel
        const [eventTypes, liveEventsData] = await Promise.all([
          getEventTypes(),
          fetchLiveEvents()
        ]);
        
        if (alive) {
          setLiveEvents(liveEventsData);
          
          // Map event types to VipEvent format using actual live event times
          const list: VipEvent[] = eventTypes.map((eventType) => {
            // Find the latest live event for this event type
            const matchingLiveEvents = liveEventsData.filter(
              liveEvent => liveEvent.type === eventType.internalName
            );
            
            // Get the latest event by start time, only if it's within 12 hours from now
            let startsAt;
            if (matchingLiveEvents.length > 0) {
              const latestEvent = matchingLiveEvents.sort((a, b) => 
                new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
              )[0];
              
              // Check if the event is not older than 12 hours from now
              const now = new Date();
              const eventTime = new Date(latestEvent.startTime);
              const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
              
              if (eventTime >= twelveHoursAgo) {
                startsAt = latestEvent.startTime;
              } else {
                startsAt = undefined;
              }
            } else {
              startsAt = undefined;
            }
            // Map category based on internalName patterns
            let category: VipEvent["category"] = "other";
            if (eventType.internalName.includes("rough_rock") || eventType.internalName.includes("rough")) {
              category = "rough_rock";
            } else if (eventType.internalName.includes("machine") || eventType.internalName.includes("tool")) {
              category = "machines";
            } else if (eventType.internalName.includes("agate")) {
              category = "agate";
            }
            
            return {
              id: eventType.internalName,
              name: eventType.label,
              startsAt,
              description: eventType.description,
              zoomJoinUrl: "#", // Will be handled by button logic
              category,
            };
          });
          
          setEvents(list);
        }
      } catch (e) {
        if (alive) {
          const errorMessage = e instanceof Error ? e.message : "Failed to load events";
          setError(errorMessage);
          setEvents(DEMO_EVENTS);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Fetch HubSpot contact data when hsId is available
  useEffect(() => {
    if (!hsId) {
      setHubspotContact(null);
      return;
    }

    (async () => {
      try {
        const contactRes = await fetch(`/api/hubspot/contact?contactId=${hsId}`, {
          cache: "no-store",
        });
        
        if (contactRes.ok) {
          const contactData = await contactRes.json();
          if (contactData?.properties) {
            setHubspotContact({
              firstname: contactData.properties.firstname || "",
              lastname: contactData.properties.lastname || "",
              email: contactData.properties.email || "",
            });
          }
        }
      } catch (err) {
        console.log("Could not fetch HubSpot contact data:", err);
        setHubspotContact(null);
      }
    })();
  }, [hsId]);

  return (
    <div className="relative space-y-8">
      <div className="pointer-events-none absolute inset-0 -z-10 rounded-xl">
        <div className="absolute inset-0 bg-[radial-gradient(120%_140%_at_50%_-20%,#FFFFEC,transparent_60%),linear-gradient(180deg,#FFFFFF_0%,#FFFFEC_50%,#FFFFFF_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(60%_40%_at_20%_10%,rgba(140,15,15,0.06),transparent_60%),radial-gradient(40%_30%_at_90%_20%,rgba(224,28,36,0.05),transparent_60%)]" />
      </div>

      <header className="mb-1">
        <h1 className="text-2xl font-bold text-[#17152A]">Welcome!</h1>
        <div className="mt-2 h-0.5 w-16 rounded-full bg-gradient-to-r from-[#8C0F0F] to-[#E01C24]" />
      </header>

      <section>
        <h3 className="mb-3 text-sm font-medium tracking-wide text-[#17152A]">
          Your VIP Events
        </h3>

        {/* Vertical, beautiful list */}
        <div className="grid grid-cols-1 gap-4">
          <AnimatePresence initial={false}>
            {!events &&
              Array.from({ length: 3 }).map((_, i) => (
                <CardSkeleton key={`sk-${i}`} />
              ))}

            {events?.map((e) => {
              const pill = categoryPill(e.category);
              return (
                <motion.article
                  key={e.id}
                  layout
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8 }}
                  whileHover={{ y: -2 }}
                  className="relative overflow-hidden rounded-2xl border border-[#EAEAEA] bg-white shadow-[0_8px_28px_rgba(0,0,0,0.06)]"
                >
                  <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-[#8C0F0F] to-[#E01C24]" />
                  <div className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-500 pointer-events-none">
                    <div className="absolute -inset-1 rounded-3xl bg-[conic-gradient(from_180deg,rgba(237,28,36,0.08),rgba(255,255,236,0.0),rgba(237,28,36,0.08))] blur-xl" />
                  </div>

                  <div className="relative">
                    <div className="aspect-[16/9] w-full bg-[#FFFFF4] grid place-items-center">
                      <div className="absolute inset-0 m-4 rounded-xl border-2 border-dashed border-[#E0E0CF] grid place-items-center">
                        <span className="text-xs font-medium tracking-wide text-[#9A9985]">
                          Image here
                        </span>
                      </div>
                    </div>

                    <div className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full border border-[#EFEFEF] bg-white/85 px-3 py-1 text-xs font-medium shadow-sm backdrop-blur">
                      <Sparkles className="h-3.5 w-3.5 text-[#8C0F0F]" />
                      <span
                        className={pill.className + " rounded-full px-2 py-0.5"}
                      >
                        {pill.label}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div>
                        <h4 className="text-[16px] font-semibold text-[#17152A]">
                          {e.name}
                        </h4>
                        <p className="mt-1 text-sm text-[#17152A]/70">
                          {e.description}
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-[#17152A]">
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#FAFAF7] px-2.5 py-1 border border-[#EFEFE5]">
                            <Clock className="h-3.5 w-3.5" />
                            {e.startsAt ? whenText(e.startsAt) : "TBA"}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#F8FAFF] px-2.5 py-1 border border-[#EAF0FF]">
                            <Users className="h-3.5 w-3.5" />
                            Live
                          </span>
                        </div>
                      </div>

                      <div className="sm:pt-1 w-full sm:w-auto">
                        <button
                          title={loadingEventId === e.id ? "Joining..." : "Join live session"}
                          onClick={async () => {
                            if (!hubspotContact?.email) {
                              toast.error("User email not found. Please update your profile.");
                              return;
                            }

                            try {
                              setLoadingEventId(e.id);
                              
                              // Get user info from HubSpot contact
                              const email = hubspotContact.email;
                              const firstName = hubspotContact.firstname || "";
                              const lastName = hubspotContact.lastname || "";
                              
                              // Check if firstName or lastName is missing
                              if (!firstName.trim() || !lastName.trim()) {
                                setShowProfileUpdateDialog(true);
                                return;
                              }
                              
                              const matchingLiveEvents = liveEvents.filter(
                                liveEvent => liveEvent.type === e.id
                              );
                              
                              if (matchingLiveEvents.length === 0) {
                                throw new Error("No live events found for this event type");
                              }
                              
                              // Get the latest event (sort by date/startTime to get most recent)
                              const latestEvent = matchingLiveEvents.sort((a, b) => 
                                new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
                              )[0];

                              // Check if the event is currently joinable (within 12-hour threshold)
                              const isJoinable = await isEventCurrentlyLive(latestEvent);
                              if (!isJoinable) {
                                toast.error("This event is not currently available to join. Please check back within 12 hours of the event time.");
                                return;
                              }
                              
                              console.log(`🚀 -> Joining event type: ${e.id}, using live event ID: ${latestEvent.id}`);
                              
                              const result = await joinLiveSession(latestEvent.id, { email, firstName, lastName });
                              console.log("Join session result:", result);
                              
                              if (result.success && result.joinUrl) {
                                // Open new tab with join URL
                                window.open(result.joinUrl, '_blank');
                              } else {
                                throw new Error(result.message || "Failed to get join URL");
                              }
                            } catch (error) {
                              console.error("Failed to join session:", error);
                              toast.error(`Failed to join session: ${error instanceof Error ? error.message : "Unknown error"}`);
                            } finally {
                              setLoadingEventId(null);
                            }
                          }}
                          disabled={loadingEventId === e.id}
                          className={`cursor-pointer inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-all ${
                            loadingEventId === e.id 
                              ? 'bg-gray-400 pointer-events-none' 
                              : 'bg-[#17152A] hover:bg-[#8C0F0F] active:scale-98'
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
                className="relative overflow-hidden rounded-2xl border border-[#BFBFBF] bg-[#FFFFEC] p-10 text-center"
              >
                <div className="inline-flex items-center gap-2 rounded-full border border-[#BFBFBF] bg-white/60 px-4 py-1 text-xs text-[#17152A]">
                  <Sparkles className="h-3.5 w-3.5 text-[#8C0F0F]" />
                  VIP Room
                </div>
                <h3 className="mt-4 text-2xl sm:text-3xl font-semibold text-[#17152A]">
                  (Coming Soon) No upcoming events yet
                </h3>
                <p className="mt-2 text-[#17152A]/70">
                  Subscribe to events and your personal VIP join banners will
                  appear here.
                </p>
                {error && (
                  <p className="mt-4 text-[12px] text-[#8C0F0F]">{error}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* Profile Update Dialog */}
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
                Complete your profile to join live sessions
              </Typography>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Box className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
              To join the live session, we need your first and last name. Please update your profile with this information.
            </Typography>
          </Box>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2, gap: 1.5 }}>
          <Button
            variant="outlined"
            onClick={() => setShowProfileUpdateDialog(false)}
            sx={{ 
              textTransform: "none",
              borderColor: "#d1d5db",
              color: "#6b7280",
              "&:hover": { borderColor: "#9ca3af", backgroundColor: "#f9fafb" }
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              setShowProfileUpdateDialog(false);
              router.push("/profile");
            }}
            sx={{
              textTransform: "none",
              backgroundColor: "#17152A",
              "&:hover": { backgroundColor: "#8C0F0F" }
            }}
          >
            Update Profile
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
