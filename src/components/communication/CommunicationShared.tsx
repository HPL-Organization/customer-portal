"use client";

import * as React from "react";
import { Check } from "lucide-react";

export function Checkbox({ 
  checked, 
  onChange, 
  disabled = false 
}: { 
  checked: boolean, 
  onChange?: () => void, 
  disabled?: boolean 
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onChange}
      className={`w-5 h-5 rounded flex items-center justify-center border transition-all ${
        checked 
          ? "bg-[#10b981] border-[#10b981]" 
          : "bg-white border-zinc-400"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:scale-105 active:scale-95"}`}
    >
      {checked && <Check className="w-4 h-4 text-white" strokeWidth={4} />}
    </button>
  );
}

export function TitleSection({ title, subtitle, redSubtitle }: { title: string, subtitle?: string, redSubtitle?: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-bold text-zinc-900">{title}</h1>
      <div className="w-32 h-1 bg-red-600 mt-1 mb-6" />
      
      {redSubtitle && (
        <p className="text-red-600 font-bold text-lg mb-2">
          {redSubtitle}
        </p>
      )}
      {subtitle && (
        <p className="text-zinc-600 text-sm font-medium">
          {subtitle}
        </p>
      )}
    </div>
  );
}

export function ActionButtons({ onCancel, onSave, saving = false }: { onCancel: () => void, onSave: () => void, saving?: boolean }) {
  return (
    <div className="flex justify-end gap-3 mt-8">
      <button 
        onClick={onCancel}
        disabled={saving}
        className="px-8 py-2.5 bg-zinc-300 hover:bg-zinc-400 disabled:opacity-50 text-zinc-900 font-bold rounded-lg text-sm transition-colors"
      >
        CANCEL
      </button>
      <button 
        onClick={onSave}
        disabled={saving}
        className="px-8 py-2.5 bg-[#ef4444] hover:bg-red-700 disabled:opacity-60 text-white font-bold rounded-lg text-sm transition-colors shadow-md active:translate-y-0.5 min-w-[80px]"
      >
        {saving ? "Saving…" : "SAVE"}
      </button>
    </div>
  );
}
