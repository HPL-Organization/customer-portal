"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { LandingView } from "@/components/communication/LandingView";
import { LiveEventsView } from "@/components/communication/LiveEventsView";
import { PromotionsView } from "@/components/communication/PromotionsView";
import { NewslettersView } from "@/components/communication/NewslettersView";
import { SupportView } from "@/components/communication/SupportView";
import { useCustomerBootstrap } from "@/components/providers/CustomerBootstrap";
import { toast } from "react-toastify";

type View = "landing" | "live-events" | "newsletters" | "promotions" | "support";

export interface Preferences {
  liveEvents: {
    general: string;
    reminders: string;
    email: boolean;
    sms: boolean;
  };
  newsletters: {
    frequency: string;
    email: boolean;
  };
  promotions: {
    general: string;
    discounts: string;
    newProducts: string;
    email: boolean;
  };
  support: {
    ticketsEmail: boolean;
    ticketsSms: boolean;
    orderUpdatesEmail: boolean;
    orderUpdatesSms: boolean;
  };
}

const DEFAULTS: Preferences = {
  liveEvents:  { general: 'all', reminders: 'none', email: true,  sms: false },
  newsletters: { frequency: 'all', email: true },
  promotions:  { general: 'all', discounts: 'all', newProducts: 'all', email: true },
  support:     { ticketsEmail: true, ticketsSms: false, orderUpdatesEmail: true, orderUpdatesSms: true },
};

/** Map a DB row's flat fields back onto the Preferences shape */
function rowToPreferences(row: any): Preferences {
  return {
    liveEvents: {
      general:   row.live_events_general   ?? 'all',
      reminders: row.live_events_reminders ?? 'none',
      email:     !!row.live_events_channel_email,
      sms:       !!row.live_events_channel_sms,
    },
    newsletters: {
      frequency: row.newsletters_frequency ?? 'all',
      email:     true,
    },
    promotions: {
      general:     row.promotions_general      ?? 'all',
      discounts:   row.promotions_discounts    ?? 'all',
      newProducts: row.promotions_new_products ?? 'all',
      email:       true,
    },
    support: {
      ticketsEmail:      !!row.support_tickets_email,
      ticketsSms:        !!row.support_tickets_sms,
      orderUpdatesEmail: true,   // always on — read-only
      orderUpdatesSms:   true,
    },
  };
}

export default function CommunicationPage() {
  const { nsId } = useCustomerBootstrap();
  const [view, setView]               = useState<View>("landing");
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [loadingPrefs, setLoadingPrefs] = useState(true);

  // ── Load saved preferences on mount ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoadingPrefs(true);
      try {
        const url = nsId && nsId !== "-1"
          ? `/api/supabase/communication-preferences?nsId=${encodeURIComponent(nsId)}`
          : `/api/supabase/communication-preferences`;

        const res  = await fetch(url, { cache: "no-store" });
        const json = await res.json();

        if (!res.ok) {
          toast.error(json.error ?? "Failed to load preferences.");
          return;
        }

        if (json.data) {
          setPreferences(rowToPreferences(json.data));
        }
        // if json.data is null → no row yet → show defaults (already set)
      } catch (err: any) {
        console.error("[comm-prefs] load error:", err);
        toast.error("Failed to load your communication preferences.");
      } finally {
        setLoadingPrefs(false);
      }
    })();
  }, [nsId]);

  const renderView = () => {
    if (loadingPrefs) {
      return (
        <div className="flex items-center justify-center py-24 text-zinc-500 text-sm">
          Loading your preferences…
        </div>
      );
    }

    switch (view) {
      case "landing":
        return <LandingView onSelect={setView} />;
      case "live-events":
        return (
          <LiveEventsView
            prefs={preferences.liveEvents}
            setPrefs={(p) => setPreferences({ ...preferences, liveEvents: p })}
            onBack={() => setView("landing")}
          />
        );
      case "promotions":
        return (
          <PromotionsView
            prefs={preferences.promotions}
            setPrefs={(p) => setPreferences({ ...preferences, promotions: p })}
            onBack={() => setView("landing")}
          />
        );
      case "newsletters":
        return (
          <NewslettersView
            prefs={preferences.newsletters}
            setPrefs={(p) => setPreferences({ ...preferences, newsletters: p })}
            onBack={() => setView("landing")}
          />
        );
      case "support":
        return (
          <SupportView
            prefs={preferences.support}
            setPrefs={(p) => setPreferences({ ...preferences, support: p })}
            onBack={() => setView("landing")}
          />
        );
      default:
        return <LandingView onSelect={setView} />;
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <main className="pb-20">
        {renderView()}
      </main>
    </div>
  );
}
