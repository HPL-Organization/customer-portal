"use client";

import * as React from "react";
import { TitleSection } from "./CommunicationShared";

type View = "landing" | "live-events" | "newsletters" | "promotions" | "support";

export function LandingView({ onSelect }: { onSelect: (view: View) => void }) {
  const categories = [
    {
      id: "live-events" as View,
      title: "Live Events",
      description: "Live events every Monday to Saturday. Choose the communications and reminders you would like to receive.",
    },
    {
      id: "newsletters" as View,
      title: "Educational Newsletters and Guides",
      description: "Receive emails or sms updates when we send out new educational content about machines or rough rock, maintenance, and other guides.",
    },
    {
      id: "promotions" as View,
      title: "Promotions and Announcements",
      description: "Receive emails or sms updates when we have ongoing discounts, giveaways, or when we release new products.",
    },
    {
      id: "support" as View,
      title: "Customer Support",
      description: "Receive emails or sms regarding your support tickets and order updates.",
    },
  ];

  return (
    <div className="max-w-4xl mx-auto py-10 px-6">
      <TitleSection 
        title="Email and Communications Preference" 
        redSubtitle="Update your email and SMS notifications and preferences"
      />
      
      <div className="bg-[#e5e7eb] rounded-xl p-8 space-y-5 shadow-inner">
        {categories.map((cat) => (
          <div key={cat.id} className="bg-[#d1d5db]/50 rounded-xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 border border-zinc-300/50">
            <div className="max-w-2xl">
              <h2 className="text-xl font-bold text-zinc-900 mb-2">{cat.title}</h2>
              <p className="text-zinc-700 text-[15px] leading-snug font-medium">{cat.description}</p>
            </div>
            <button 
              onClick={() => onSelect(cat.id)}
              className="px-10 py-2.5 bg-zinc-300 hover:bg-zinc-400 text-zinc-900 font-bold rounded-lg text-sm transition-all shadow-sm border border-zinc-400/30 whitespace-nowrap"
            >
              SELECT
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
