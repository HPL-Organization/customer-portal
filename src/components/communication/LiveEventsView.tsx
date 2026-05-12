"use client";

import * as React from "react";
import { useState } from "react";
import { Check } from "lucide-react";
import { toast } from "react-toastify";
import { TitleSection, Checkbox, ActionButtons } from "./CommunicationShared";
import { useCustomerBootstrap } from "@/components/providers/CustomerBootstrap";


export function LiveEventsView({ prefs, setPrefs, onBack }: { 
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

  const reminderOptions = [
    { id: 'none', label: "I don\u2019t need reminders." },
    { id: 'hour', label: 'Remind me an hour before the event.' },
    { id: 'day', label: 'Remind me one day before the event.' },
  ];

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/supabase/communication-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: "liveEvents",
          prefs,
          nsId: nsId && nsId !== "-1" ? Number(nsId) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to save");
      toast.success("Live Events preferences saved!");
      onBack();
    } catch (err: any) {
      console.error("[comm-prefs:liveEvents]", err);
      toast.error(err?.message ?? "Failed to save preferences.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-10 px-6">
      <TitleSection 
        title="Email and Communications Preference" 
        redSubtitle="Select whether to receive emails or sms only, or both notifications. Choose the frequency."
      />
      
      <div className="bg-[#e5e7eb] rounded-xl p-8 shadow-inner">
        <h2 className="text-xl font-bold text-zinc-900 mb-6">Live Events Communication</h2>
        
        <div className="bg-[#d1d5db]/60 rounded-xl overflow-hidden mb-6 border border-zinc-300">
          <div className="flex justify-between items-center py-3 px-6 bg-[#bfc5d1]">
            <h3 className="font-bold text-zinc-900">General</h3>
            <span className="font-bold text-zinc-900">Email</span>
          </div>
          {options.map((opt, idx) => (
            <div key={opt.id} className={`flex justify-between items-center py-4 px-6 ${idx !== options.length - 1 ? 'border-b border-zinc-300' : ''}`}>
              <span className="text-zinc-800 text-[15px] font-medium">{opt.label}</span>
              <Checkbox checked={prefs.general === opt.id} onChange={() => setPrefs({ ...prefs, general: opt.id })} />
            </div>
          ))}
        </div>

        <div className="bg-[#d1d5db]/60 rounded-xl overflow-hidden mb-8 border border-zinc-300">
          <div className="py-3 px-6 bg-[#bfc5d1]">
            <h3 className="font-bold text-zinc-900">Reminders</h3>
          </div>
          {reminderOptions.map((opt, idx) => (
            <div key={opt.id} className={`flex justify-between items-center py-4 px-6 ${idx !== reminderOptions.length - 1 ? 'border-b border-zinc-300' : ''}`}>
              <span className="text-zinc-800 text-[15px] font-medium">{opt.label}</span>
              <Checkbox checked={prefs.reminders === opt.id} onChange={() => setPrefs({ ...prefs, reminders: opt.id })} />
            </div>
          ))}
        </div>

        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex bg-[#bfc5d1] p-1.5 rounded-xl shadow-inner w-fit">
            <button 
              type="button"
              onClick={() => setPrefs({ ...prefs, email: !prefs.email })}
              className={`px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${prefs.email ? 'bg-[#10b981] text-white shadow-sm' : 'text-zinc-600 hover:text-zinc-800'}`}
            >
              Email {prefs.email && <Check className="w-3.5 h-3.5" strokeWidth={4} />}
            </button>
            <button 
              type="button"
              onClick={() => setPrefs({ ...prefs, sms: !prefs.sms })}
              className={`px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${prefs.sms ? 'bg-[#10b981] text-white shadow-sm' : 'text-zinc-600 hover:text-zinc-800'}`}
            >
              SMS {prefs.sms && <Check className="w-3.5 h-3.5" strokeWidth={4} />}
            </button>
          </div>

          <ActionButtons onCancel={onBack} onSave={handleSave} saving={saving} />
        </div>
      </div>
    </div>
  );
}
