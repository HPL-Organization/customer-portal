"use client";

import * as React from "react";
import { useState } from "react";
import { toast } from "react-toastify";
import { TitleSection, Checkbox, ActionButtons } from "./CommunicationShared";
import { useCustomerBootstrap } from "@/components/providers/CustomerBootstrap";

export function NewslettersView({ prefs, setPrefs, onBack }: { 
  prefs: any, 
  setPrefs: (p: any) => void, 
  onBack: () => void 
}) {
  const { nsId } = useCustomerBootstrap();
  const [saving, setSaving] = useState(false);

  const options = [
    { id: 'all', label: 'All of them' },
    { id: 'weekly', label: 'Weekly summary' },
    { id: 'monthly', label: 'Monthly summary' },
    { id: 'none', label: "I don\u2019t want to receive anything from here." },
  ];

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/supabase/communication-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "newsletters",
          prefs,
          nsId: nsId && nsId !== "-1" ? Number(nsId) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to save");
      toast.success("Newsletter preferences saved!");
      onBack();
    } catch (err: any) {
      console.error("[comm-prefs:newsletters]", err);
      toast.error(err?.message ?? "Failed to save preferences.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-10 px-6">
      <TitleSection 
        title="Email and Communications Preference" 
        redSubtitle="Choose the frequency."
      />
      
      <div className="bg-[#e5e7eb] rounded-xl p-8 shadow-inner">
        <h2 className="text-xl font-bold text-zinc-900 mb-6">Educational Newsletters and Guides</h2>
        
        <div className="bg-[#d1d5db]/60 rounded-xl overflow-hidden border border-zinc-300">
          <div className="flex justify-between items-center py-3 px-6 bg-[#bfc5d1]">
            <h3 className="font-bold text-zinc-900">Email</h3>
            <span className="invisible font-bold text-zinc-900">Email</span>
          </div>
          {options.map((opt, idx) => (
            <div key={opt.id} className={`flex justify-between items-center py-4 px-6 ${idx !== options.length - 1 ? 'border-b border-zinc-300' : ''}`}>
              <span className="text-zinc-800 text-[15px] font-medium">{opt.label}</span>
              <Checkbox checked={prefs.frequency === opt.id} onChange={() => setPrefs({ ...prefs, frequency: opt.id })} />
            </div>
          ))}
        </div>

        <ActionButtons onCancel={onBack} onSave={handleSave} saving={saving} />
      </div>
    </div>
  );
}
