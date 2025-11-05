"use client";

import { CardSkeleton, EventCard } from "@/components/EventCard";
import { ProfileUpdateDialog } from "@/components/ProfileUpdateDialog";
import { useCustomerBootstrap } from "@/components/providers/CustomerBootstrap";
import {
  fetchLiveEvents,
  getEventTypes,
  isEventCurrentlyLive,
  joinLiveSession,
  type LiveEvent,
} from "@/lib/actions/livesaleapp";
import { processEvents, type VipEvent } from "@/lib/utils/events";
import { createBrowserClient } from "@supabase/ssr";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import TermsModal from "@/components/TermsModal";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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

  const [showTerms, setShowTerms] = useState(false);
  const [agreeSaving, setAgreeSaving] = useState(false);
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);

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
        const [eventTypes, liveEventsResult] = await Promise.all([
          getEventTypes(),
          fetchLiveEvents(),
        ]);
        if (!alive) return;

        setLoaderProgress(62);

        if (!liveEventsResult.success) {
          toast.error(liveEventsResult.message || "Failed to load live events");
          setLiveEvents([]);
        } else {
          setLiveEvents(liveEventsResult.events || []);
        }

        const liveEventsData = liveEventsResult.events || [];
        const list = processEvents(eventTypes, liveEventsData);

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

  async function handleJoinEvent(eventId: string) {
    try {
      if (!authEmail) {
        toast.error("User email not found.");
        return;
      }
      setLoadingEventId(eventId);
      setLoaderLabel("Joining live session…");

      const names = await ensureNames();
      if (!names) return;

      const latestEvent = liveEvents.find((le) => le.type === eventId);
      if (!latestEvent) {
        toast.error("No live events found for this event type");
        return;
      }

      const ok = await ensureTermsAccepted();
      if (!ok) {
        setPendingEventId(latestEvent.id);
        setLoadingEventId(null);
        return;
      }

      const isJoinable = await isEventCurrentlyLive(latestEvent);
      if (!isJoinable) {
        toast.error(
          "This event is not currently available to join. Please check back within 30 minutes of the event time."
        );
        return;
      }

      const result = await joinLiveSession(latestEvent.id, {
        email: authEmail,
        firstName: names.firstName,
        lastName: names.lastName,
      });
      if (result.success && result.joinUrl) {
        window.open(result.joinUrl, "_blank");
      } else {
        toast.error(result.message || "Failed to get join URL");
      }
    } catch (error) {
      toast.error(
        `Failed to join session: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    } finally {
      setLoadingEventId(null);
      setLoaderLabel("Cutting your rock…");
    }
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

      const latestEvent = liveEvents.find((le) => le.type === targetEventId);
      if (!latestEvent) {
        toast.error("No live events found for this event type");
        return;
      }
      // const matchingLiveEvents = liveEvents.filter(
      //   (le) => le.type === targetEventId
      // );
      // if (matchingLiveEvents.length === 0) {
      //   toast.error("No live events found for this event type");
      //   return;
      // }
      // const latestEvent = matchingLiveEvents.sort(
      //   (a, b) =>
      //     new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
      // )[0];
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

  async function getTermsStatus() {
    const res = await fetch("/api/supabase/customer-terms", {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("Failed to check terms");
    return (await res.json()) as {
      ok: boolean;
      exists?: boolean;
      terms_compliance?: boolean;
      terms_agreed_at?: string | null;
    };
  }

  async function postAgreeTerms() {
    const res = await fetch("/api/supabase/customer-terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agree: true }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error || "Failed to save terms");
    }
    return res.json();
  }

  async function ensureTermsAccepted(): Promise<boolean> {
    try {
      const st = await getTermsStatus();
      if (st?.terms_compliance) return true;
      setShowTerms(true);
      return false;
    } catch {
      setShowTerms(true);
      return false;
    }
  }

  async function handleAgreeAndContinue() {
    try {
      setAgreeSaving(true);
      await postAgreeTerms();
      setShowTerms(false);

      if (!pendingEventId) return;

      const latestEvent = liveEvents.find(
        (le) => le.id === pendingEventId || le.type === pendingEventId
      );
      if (!latestEvent) return;

      const isJoinable = await isEventCurrentlyLive(latestEvent);
      if (!isJoinable) {
        toast.error(
          "This event is not currently available to join. Please check back within 30 minutes of the event time."
        );
        return;
      }

      setLoadingEventId(latestEvent.type ?? latestEvent.id);
      setLoaderLabel("Joining live session…");

      const result = await joinLiveSession(latestEvent.id, {
        email: authEmail,
        firstName: authFirstName || "Guest",
        lastName: authLastName || "",
      });

      if (result.success && result.joinUrl) {
        window.open(result.joinUrl, "_blank");
      } else {
        toast.error(result.message || "Failed to get join URL");
      }
    } catch (e) {
      toast.error(
        `Could not save your acceptance: ${
          e instanceof Error ? e.message : "Unknown error"
        }`
      );
    } finally {
      setAgreeSaving(false);
      setPendingEventId(null);
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

            {events?.map((e) => (
              <EventCard
                key={e.id}
                event={e}
                onJoinClick={handleJoinEvent}
                loadingEventId={loadingEventId}
              />
            ))}

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

      <ProfileUpdateDialog
        open={showProfileUpdateDialog}
        onClose={() => setShowProfileUpdateDialog(false)}
        firstName={formFirstName}
        onFirstNameChange={setFormFirstName}
        middleName={formMiddleName}
        onMiddleNameChange={setFormMiddleName}
        lastName={formLastName}
        onLastNameChange={setFormLastName}
        onSave={() => saveNamesAndProceed(loadingEventId || "")}
        saving={savingProfile}
      />
      <TermsModal
        open={showTerms}
        loading={agreeSaving}
        text="I agree to the event Terms & Conditions and understand that all winning bids are binding."
        onCancel={() => {
          setShowTerms(false);
          setPendingEventId(null);
        }}
        onConfirm={handleAgreeAndContinue}
      />
    </div>
  );
}
