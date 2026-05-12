"use client";

import * as React from "react";
import { useState } from "react";
import { toast } from "react-toastify";
import { TitleSection, Checkbox, ActionButtons } from "./CommunicationShared";
import { useCustomerBootstrap } from "@/components/providers/CustomerBootstrap";

export function SupportView({ prefs, setPrefs, onBack }: { 
  prefs: any, 
  setPrefs: (p: any) => void, 
  onBack: () => void 
}) {
  const { nsId } = useCustomerBootstrap();
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/supabase/communication-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "support",
          prefs,
          nsId: nsId && nsId !== "-1" ? Number(nsId) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to save");
      toast.success("Customer Support preferences saved!");
      onBack();
    } catch (err: any) {
      console.error("[comm-prefs:support]", err);
      toast.error(err?.message ?? "Failed to save preferences.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-10 px-6">
      <TitleSection 
        title="Highland Park Lapidary" 
        redSubtitle="Select whether to receive emails or sms only, or both notifications."
      />
      
      <div className="bg-[#e5e7eb] rounded-xl p-8 shadow-inner">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-zinc-900">Customer Support</h2>
          <div className="flex gap-12 px-6">
            <span className="font-bold text-zinc-900">Email</span>
            <span className="font-bold text-zinc-900">SMS</span>
          </div>
        </div>
        
        <div className="space-y-4">
          <div className="bg-[#d1d5db]/60 rounded-xl p-6 border border-zinc-300 flex justify-between items-start gap-8">
            <div className="flex-1">
              <h3 className="font-bold text-zinc-900 mb-2">Support Tickets</h3>
              <p className="text-zinc-800 text-sm font-medium">
                Warning: If you deselect email for support tickets, you wouldn&apos;t receive any updates regarding your ticket.
              </p>
            </div>
            <div className="flex gap-[68px] pt-1">
              <Checkbox checked={prefs.ticketsEmail} onChange={() => setPrefs({ ...prefs, ticketsEmail: !prefs.ticketsEmail })} />
              <Checkbox checked={prefs.ticketsSms} onChange={() => setPrefs({ ...prefs, ticketsSms: !prefs.ticketsSms })} />
            </div>
          </div>

          <div className="bg-[#d1d5db]/60 rounded-xl p-6 border border-zinc-300 flex justify-between items-start gap-8">
            <div className="flex-1">
              <h3 className="font-bold text-zinc-900 mb-2">Order Updates</h3>
              <p className="text-zinc-800 text-sm font-medium">
                Note: You&apos;ll always receive ticket updates, sales receipts, order confirmations, and shipping updates. This cannot be turned off.
              </p>
            </div>
            <div className="flex gap-[68px] pt-1">
              <Checkbox checked={prefs.orderUpdatesEmail} disabled />
              <Checkbox checked={prefs.orderUpdatesSms} disabled />
            </div>
          </div>
        </div>

        <ActionButtons onCancel={onBack} onSave={handleSave} saving={saving} />
      </div>
    </div>
  );
}
