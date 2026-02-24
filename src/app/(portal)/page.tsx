"use client";

import { CardSkeleton, EventCard } from "@/components/EventCard";
import { ProfileUpdateDialog } from "@/components/ProfileUpdateDialog";
import { useBilling } from "@/components/providers/BillingProvider";
import { useCustomerBootstrap } from "@/components/providers/CustomerBootstrap";
import TermsModal from "@/components/TermsModal";
import { openPlaceholderPopup } from "@/components/UI/popup";
import {
  fetchLiveEvents,
  getEventTypes,
  isEventCurrentlyLive,
  joinLiveSession,
  type EventsRouteResponse,
  type LiveEvent,
} from "@/lib/actions/livesaleapp";
import { processEvents, type VipEvent } from "@/lib/utils/events";
import { createBrowserClient } from "@supabase/ssr";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import type {
  InvoiceDateParts,
  InvoiceRange,
} from "./admin/manage-users/actions";
import UnpaidInvoicesModal from "@/components/UI/UnpaidInvoicesModal";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
const SAFETY_MS = 6 * 60 * 60 * 1000;

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
  const [showInvoiceWarning, setShowInvoiceWarning] = useState(false);
  const [invoiceGraceDays, setInvoiceGraceDays] = useState<number | null>(null);
  const [pendingJoinAfterInvoiceWarning, setPendingJoinAfterInvoiceWarning] =
    useState<null | (() => Promise<void>)>(null);

  const {
    invoices,
    unpaidInvoices,
    loading: billingLoading,
    error: billingError,
    refresh: refreshBilling,
  } = useBilling();
  // console.log(
  //   "invoices",
  //   invoices,
  //   "unpaidInvoices",
  //   unpaidInvoices,
  //   "billingLoading",
  //   billingLoading,
  //   "billingError",
  //   billingError
  // );

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

        const res = await fetch("/api/supabase/events/get", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });

        if (!res.ok) {
          throw new Error(`Failed to load events (${res.status})`);
        }

        const json = (await res.json()) as EventsRouteResponse;
        if (!alive) return;

        const [eventTypes, liveEventsResult] = await Promise.all([
          getEventTypes(json),
          fetchLiveEvents(1, json),
        ]);

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

  const visibleEvents = useMemo(() => {
    if (!events) return null;

    const now = Date.now();

    const liveByKey = new Map<string, LiveEvent>();
    for (const le of liveEvents || []) {
      if (le?.id) liveByKey.set(le.id, le);
      if (le?.type) liveByKey.set(le.type, le);
    }

    function withinSafety(le?: LiveEvent) {
      if (!le?.startTime) return false;
      const start = new Date(le.startTime).getTime();
      return start <= now && now - start < SAFETY_MS;
    }

    return events.filter((e) => {
      const le = liveByKey.get((e as any).type ?? (e as any).id);

      if (e._live?.isLive) return true;

      if (le?.startTime && new Date(le.startTime).getTime() >= now) return true;

      if (withinSafety(le)) return true;

      return false;
    });
  }, [events, liveEvents]);

  function datePartsToDate(parts?: InvoiceDateParts | null): Date | null {
    if (!parts) return null;
    return new Date(parts.year, parts.month - 1, parts.day);
  }

  function startOfDay(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function dayDiffInclusive(a: Date, b: Date) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const aa = startOfDay(a).getTime();
    const bb = startOfDay(b).getTime();
    return Math.max(1, Math.round((bb - aa) / msPerDay) + 1);
  }

  function formatRangeForMessage(range: InvoiceRange | null): string {
    if (!range || !range.from) return "the configured date window";

    const d = datePartsToDate(range.from);
    if (!d || Number.isNaN(d.getTime())) return "the configured date window";

    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function hasUnpaidOlderThanThreshold(
    invoices: typeof unpaidInvoices,
    range: InvoiceRange | null
  ): boolean | null {
    if (!range || !range.from) return null;

    const mode = (range as any).mode ?? "rolling";
    const fromDate = datePartsToDate(range.from);
    if (!fromDate) return null;

    const isInvoiceBackordered = (inv: any) =>
      inv.isBackordered === true || inv.is_backordered === true;

    const isLiveEventRep = (inv: any) => {
      const repRaw =
        (inv as any).salesRep ??
        (inv as any).sales_rep ??
        (inv as any).salesrep ??
        "";
      const rep = String(repRaw).trim().toLowerCase();
      return rep === "live event";
    };

    const isPaymentProcessing = (inv: any) =>
      (inv as any).paymentProcessing === true ||
      (inv as any).payment_processing === true;

    const startOfDay = (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate());

    const dayDiffInclusive = (a: Date, b: Date) => {
      const msPerDay = 24 * 60 * 60 * 1000;
      const aa = startOfDay(a).getTime();
      const bb = startOfDay(b).getTime();
      return Math.max(1, Math.round((bb - aa) / msPerDay) + 1);
    };

    if (mode === "fixed") {
      if (!range.to) return null;
      const toDate = datePartsToDate(range.to);
      if (!toDate) return null;

      return invoices.some((inv) => {
        if (isInvoiceBackordered(inv)) return false;
        if (!isLiveEventRep(inv)) return false;
        if (!inv.trandate) return false;
        if (isPaymentProcessing(inv)) return false;

        const d = new Date(inv.trandate);
        if (Number.isNaN(d.getTime())) return false;

        return d >= fromDate && d <= toDate;
      });
    }

    // rolling = grace period N days (derived from from/to length),
    // block if any unpaid invoice is older than that grace period.
    const today = startOfDay(new Date());

    const toParts = range.to ?? range.from;
    const toDate = datePartsToDate(toParts);
    if (!toDate) return null;

    const graceDays = dayDiffInclusive(fromDate, toDate);

    // cutoff day = start of (today - (graceDays - 1))
    // N=1 => cutoff=today; blocks anything before today
    // N=2 => cutoff=yesterday; blocks anything before yesterday
    const cutoff = new Date(today);
    cutoff.setDate(today.getDate() - (graceDays - 1));

    return invoices.some((inv) => {
      if (isInvoiceBackordered(inv)) return false;
      if (!isLiveEventRep(inv)) return false;
      if (isPaymentProcessing(inv)) return false;
      if (!inv.trandate) return false;

      const d = new Date(inv.trandate);
      if (Number.isNaN(d.getTime())) return false;

      const invDay = startOfDay(d);
      return invDay < cutoff;
    });
  }
  type InvoiceCheckResult =
    | { ok: true; shouldWarn: false }
    | { ok: true; shouldWarn: true; graceDays: number }
    | { ok: false };

  function computeGraceDays(range: InvoiceRange | null): number | null {
    if (!range?.from) return null;

    const fromDate = datePartsToDate(range.from);
    if (!fromDate) return null;

    const toParts = range.to ?? range.from;
    const toDate = datePartsToDate(toParts);
    if (!toDate) return null;

    return dayDiffInclusive(fromDate, toDate);
  }

  async function runInvoiceCheck(): Promise<InvoiceCheckResult> {
    try {
      console.log("Running invoice check");
      const res = await fetch("/api/supabase/get-invoice-check", {
        cache: "no-store",
      });

      if (!res.ok) {
        console.error(
          "Failed to load customer invoice settings:",
          res.status,
          await res.text().catch(() => "")
        );
        return { ok: false };
      }

      const j = await res.json();

      const checkInvoiceRaw = j?.check_invoice;
      const rangeRaw = j?.check_invoice_range;
      const existingResultRaw = j?.check_invoice_result;

      const checkInvoice: boolean = !!checkInvoiceRaw;
      const range: InvoiceRange | null = (rangeRaw as InvoiceRange) ?? null;
      const existingResult: boolean | null =
        typeof existingResultRaw === "boolean" ? existingResultRaw : null;

      if (!checkInvoice) {
        if (existingResult !== null) {
          try {
            await fetch("/api/supabase/set-invoice-check", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ checkInvoiceResult: null }),
            });
          } catch (e) {
            console.error("Failed to reset invoice check result to null", e);
          }
        }
        return { ok: true, shouldWarn: false };
      }

      const overdue = hasUnpaidOlderThanThreshold(unpaidInvoices, range);

      if (overdue === null) {
        if (existingResult !== null) {
          try {
            await fetch("/api/supabase/set-invoice-check", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ checkInvoiceResult: null }),
            });
          } catch (e) {
            console.error("Failed to reset invoice check result to null", e);
          }
        }
        return { ok: true, shouldWarn: false };
      }

      const computedResult = overdue;

      if (computedResult !== existingResult) {
        try {
          await fetch("/api/supabase/set-invoice-check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ checkInvoiceResult: computedResult }),
          });
        } catch (e) {
          console.error("Failed to store invoice check result", e);
        }
      }

      if (!computedResult) return { ok: true, shouldWarn: false };

      const graceDays = computeGraceDays(range) ?? 0;
      return { ok: true, shouldWarn: true, graceDays };
    } catch (err) {
      console.error("Error running invoice check", err);
      return { ok: false };
    }
  }

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
    let popup: Window | null = null;
    let navigated = false;

    try {
      if (!authEmail) {
        toast.error("User email not found.");
        return;
      }

      setLoadingEventId(eventId);
      setLoaderLabel("Joining live session…");

      const names = await ensureNames();
      if (!names) return;

      const latestEvent =
        liveEvents.find((le) => le.type === eventId) ||
        liveEvents.find((le) => le.id === eventId);

      if (!latestEvent) {
        toast.error("No live events found for this event type");
        return;
      }

      const invoiceRes = await runInvoiceCheck();

      const proceedToJoin = async () => {
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

        popup = openPlaceholderPopup();

        const result = await joinLiveSession(latestEvent.id, {
          email: authEmail,
          firstName: names.firstName,
          lastName: names.lastName,
          middleName: names.middleName,
        });

        if (result.success && result.joinUrl) {
          if (popup) {
            popup.location.href = result.joinUrl;
            popup.focus?.();
            navigated = true;
          } else {
            window.location.assign(result.joinUrl);
          }
        } else {
          if (popup) popup.close();
          toast.error(
            result.message ||
              "Unable to join the live event right now. Please try again later."
          );
          return;
        }
      };

      if (invoiceRes.ok && invoiceRes.shouldWarn) {
        setInvoiceGraceDays(invoiceRes.graceDays);
        setPendingJoinAfterInvoiceWarning(() => proceedToJoin);
        setShowInvoiceWarning(true);
        return;
      }

      await proceedToJoin();
    } catch (error) {
      if (popup) (popup as any)?.close?.();
      toast.error(
        `Failed to join session: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    } finally {
      if (popup && !navigated) (popup as any)?.close?.();
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
        middleName,
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
    } catch (err) {
      toast.error(
        `Couldn't verify your term compliance status. Please review and accept to continue${
          err instanceof Error && err.message ? `: ${err.message}` : ""
        }`
      );
      setShowTerms(true);
      return false;
    }
  }

  async function handleAgreeAndContinue() {
    const popup = openPlaceholderPopup();
    let navigated = false;

    try {
      setAgreeSaving(true);
      await postAgreeTerms();
      setShowTerms(false);

      if (!pendingEventId) {
        if (popup) popup.close();
        return;
      }

      const latestEvent =
        liveEvents.find((le) => le.id === pendingEventId) ||
        liveEvents.find((le) => le.type === pendingEventId);
      if (!latestEvent) {
        if (popup) popup.close();
        return;
      }

      const isJoinable = await isEventCurrentlyLive(latestEvent);
      if (!isJoinable) {
        toast.error(
          "This event is not currently available to join. Please check back within 30 minutes of the event time."
        );
        if (popup) popup.close();
        return;
      }

      setLoadingEventId(latestEvent.type ?? latestEvent.id);
      setLoaderLabel("Joining live session…");

      const result = await joinLiveSession(latestEvent.id, {
        email: authEmail,
        firstName: authFirstName || "Guest",
        lastName: authLastName || "",
        middleName: authMiddleName || "",
      });

      if (result.success && result.joinUrl) {
        if (popup) {
          popup.location.href = result.joinUrl;
          popup.focus?.();
          navigated = true;
        } else {
          window.location.assign(result.joinUrl);
        }
      } else {
        if (popup) popup.close();
        toast.error(result.message || "Failed to get join URL");
      }
    } catch (e) {
      if (popup) popup.close();
      toast.error(
        `Could not save your acceptance: ${
          e instanceof Error ? e.message : "Unknown error"
        }`
      );
    } finally {
      if (popup && !navigated) popup.close();
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
            {!visibleEvents &&
              Array.from({ length: 3 }).map((_, i) => (
                <CardSkeleton key={`sk-${i}`} />
              ))}

            {visibleEvents?.map((e) => (
              <EventCard
                key={e.id}
                event={e}
                onJoinClick={handleJoinEvent}
                loadingEventId={loadingEventId}
              />
            ))}

            {visibleEvents && visibleEvents.length === 0 && (
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
      <UnpaidInvoicesModal
        open={showInvoiceWarning}
        graceDays={invoiceGraceDays}
        onClose={() => {
          setShowInvoiceWarning(false);
          setPendingJoinAfterInvoiceWarning(null);
        }}
        onGoToInvoices={() => {
          setShowInvoiceWarning(false);
          setPendingJoinAfterInvoiceWarning(null);
          router.push("/invoices");
        }}
        onEnterEvent={async () => {
          setShowInvoiceWarning(false);
          const fn = pendingJoinAfterInvoiceWarning;
          setPendingJoinAfterInvoiceWarning(null);
          try {
            await fn?.();
          } catch {}
        }}
      />
    </div>
  );
}
