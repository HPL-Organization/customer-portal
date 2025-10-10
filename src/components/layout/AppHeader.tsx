"use client";

import * as React from "react";
import WbSunnyRounded from "@mui/icons-material/WbSunnyRounded";
import WbTwilightRounded from "@mui/icons-material/WbTwilightRounded";
import NightsStayRounded from "@mui/icons-material/NightsStayRounded";

type Props = {
  timeZone?: string; // defaults to "America/New_York"
};

export default function AppHeader({ timeZone = "America/New_York" }: Props) {
  const [now, setNow] = React.useState(() => tzNow(timeZone));

  React.useEffect(() => {
    const id = setInterval(() => setNow(tzNow(timeZone)), 30_000);
    return () => clearInterval(id);
  }, [timeZone]);

  const hour = now.getHours();
  const { label, Icon } = greetingForHour(hour);

  const dateStr = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(now);

  const timeStr = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(now);

  return (
    <header
      style={{ ["--app-header-h" as any]: "64px" }}
      className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60"
      role="banner"
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex h-[64px] items-center justify-between">
          {/* Greeting */}
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="relative inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 via-blue-500 to-cyan-500 shadow-sm ring-1 ring-indigo-300/40"
            >
              <Icon className="h-5 w-5 text-white" />
            </span>
            <div className="leading-tight">
              <div className="text-sm text-slate-500">{dateStr}</div>
              <div className="text-base font-semibold text-slate-900">
                {label}!
              </div>
            </div>
          </div>

          {/* Live clock */}
          <div
            className="select-none rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200"
            aria-label={`Current time ${timeStr} ${shortTZ(timeZone)}`}
          >
            {timeStr} {shortTZ(timeZone)}
          </div>
        </div>
      </div>
    </header>
  );
}

/* ---------- helpers ---------- */

function tzNow(tz: string) {
  return new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
}

function greetingForHour(hour: number) {
  // Morning: 5–11:59, Afternoon: 12–16:59, Evening: 17–4:59
  if (hour >= 5 && hour < 12)
    return { label: "Good Morning", Icon: WbSunnyRounded };
  if (hour >= 12 && hour < 17)
    return { label: "Good Afternoon", Icon: WbTwilightRounded };
  return { label: "Good Evening", Icon: NightsStayRounded };
}

function shortTZ(tz: string) {
  if (tz.includes("New_York")) return "ET";
  return "";
}
