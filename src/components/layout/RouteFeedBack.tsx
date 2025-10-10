// src/components/layout/RouteFeedback.tsx
"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export default function RouteFeedback() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(true);
    const t = setTimeout(() => setShow(false), 350);
    return () => clearTimeout(t);
  }, [pathname]);
  if (!show) return null;
  return (
    <div className="fixed top-14 left-1/2 z-[70] -translate-x-1/2 rounded-full border border-slate-200 bg-white/95 px-3 py-1 text-xs text-slate-700 shadow-lg">
      Loading…
    </div>
  );
}
