import type { LiveEvent } from "@/lib/actions/livesaleapp";

export type VipEvent = {
  id: string;
  name: string;
  startsAt?: string;
  description: string;
  zoomJoinUrl: string;
  category?: "rough_rock" | "machines" | "agate" | "other";
};

export type ImageRule = { pattern: RegExp; src: string };

export const IMG_BASE = "/assets/events";

export const IMAGE_MAP_EXACT: Record<string, string> = {
  cut_and_chat_live_event: `${IMG_BASE}/cut_and_chat_live_event.png`,
  friday_rough_rock_event: `${IMG_BASE}/friday_rough_rock_event.png`,
  mineral_live_event: `${IMG_BASE}/mineral_live_event.png`,
  monday_live_event: `${IMG_BASE}/monday_live_event.png`,
  saturday_slab_event: `${IMG_BASE}/saturday_slab_event.png`,
  sphere_collectors_event: `${IMG_BASE}/sphere_collectors_event.png`,
  thursday_afternoon_live_event: `${IMG_BASE}/thursday_afternoon_live_event.png`,
  wednesday_rough_rock_event: `${IMG_BASE}/wednesday_rough_rock_event.png`,
  machine_event: `${IMG_BASE}/machine_night.png`,
  tumbling_event: `${IMG_BASE}/tumbling_event.png`,
  show_and_tell_event: `${IMG_BASE}/show_and_tell_event.png`,
};

export const IMAGE_FALLBACK_BY_KEYWORD: ImageRule[] = [
  {
    pattern: /rough|slab|rock/i,
    src: `${IMG_BASE}/Wednesday_Friday_Saturday_Rough_Rock.png`,
  },
  {
    pattern: /machine|tool/i,
    src: `${IMG_BASE}/Machine_Night_special_event.png`,
  },
  {
    pattern: /chat|cabochon|thursday/i,
    src: `${IMG_BASE}/Thursday_Cabochon_afternoon.png`,
  },
];

export function resolveEventImage(opts: {
  internalName: string;
  category?: VipEvent["category"];
}): string | null {
  const key = opts.internalName.trim().toLowerCase();
  if (IMAGE_MAP_EXACT[key]) return IMAGE_MAP_EXACT[key];
  for (const rule of IMAGE_FALLBACK_BY_KEYWORD) {
    if (rule.pattern.test(key)) return rule.src;
  }
  if (opts.category === "rough_rock")
    return "/events/Wednesday_Friday_Saturday_Rough_Rock.png";
  if (opts.category === "machines")
    return "/events/Machine_Night_special_event.png";
  return null;
}

export function whenText(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "TBA";
  const now = Date.now();
  const diffMs = d.getTime() - now;
  const minsAbs = Math.round(Math.abs(diffMs) / 60000);
  const hoursAbs = Math.floor(minsAbs / 60);

  if (diffMs > 0) {
    if (minsAbs < 60) return `in ${minsAbs}m`;
    if (hoursAbs >= 24) {
      const days = Math.floor(hoursAbs / 24);
      const remH = hoursAbs % 24;
      return remH ? `in ${days}d ${remH}h` : `in ${days}d`;
    }
    const h = hoursAbs;
    const m = minsAbs % 60;
    return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
  } else {
    if (minsAbs < 60) return `${minsAbs}m ago`;
    if (hoursAbs >= 24) {
      const days = Math.floor(hoursAbs / 24);
      const remH = hoursAbs % 24;
      return remH ? `${days}d ${remH}h ago` : `${days}d ago`;
    }
    return `${hoursAbs}h ago`;
  }
}

export function categoryPill(c?: VipEvent["category"]) {
  switch (c) {
    // case "rough_rock":
    //   return { label: "Rough Rock", className: "bg-[#FFF2F2] text-[#8C0F0F]" };
    // case "machines":
    //   return { label: "Machines", className: "bg-[#F2F7FF] text-[#0F3D8C]" };
    // case "agate":
    //   return { label: "Agate", className: "bg-[#F7FFF2] text-[#2D6A00]" };
    default:
      return { label: "VIP", className: "bg-white/70 text-[#17152A]" };
  }
}

export function parseISO(s?: string) {
  if (!s) return new Date(NaN);
  const hasTZ = /Z|[+-]\d{2}:\d{2}$/.test(s);
  return new Date(hasTZ ? s : s + "Z");
}

export function classify(event?: LiveEvent) {
  if (!event)
    return {
      isLive: false,
      badge: "Not live",
      timeText: "TBA",
      sortKey: 3,
      startsAt: undefined as string | undefined,
    };

  const now = Date.now();
  const start = parseISO(event.startTime).getTime();
  const end = event.endTime
    ? parseISO(event.endTime).getTime()
    : start + 3 * 60 * 60 * 1000;

  if (now >= start && now <= end) {
    const mins = Math.max(0, Math.round((now - start) / 60000));
    return {
      isLive: true,
      badge: "Live now",
      timeText:
        mins < 60
          ? `started ${mins}m ago`
          : `started ${Math.round(mins / 60)}h ago`,
      sortKey: 0,
      startsAt: event.startTime,
    };
  }

  if (now < start) {
    const mins = Math.round((start - now) / 60000);
    let timeText: string;
    if (mins < 60) {
      timeText = `in ${mins}m`;
    } else {
      const h = Math.floor(mins / 60);
      if (h >= 24) {
        const d = Math.floor(h / 24);
        const rh = h % 24;
        timeText = rh ? `in ${d}d ${rh}h` : `in ${d}d`;
      } else {
        const m = mins % 60;
        timeText = m ? `in ${h}h ${m}m` : `in ${h}h`;
      }
    }
    return {
      isLive: false,
      badge: "Upcoming",
      timeText,
      sortKey: 1,
      startsAt: event.startTime,
    };
  }

  const mins = Math.round((now - end) / 60000);
  let timeText: string;
  if (mins < 60) {
    timeText = `${mins}m ago`;
  } else {
    const h = Math.floor(mins / 60);
    if (h >= 24) {
      const d = Math.floor(h / 24);
      const rh = h % 24;
      timeText = rh ? `${d}d ${rh}h ago` : `${d}d ago`;
    } else {
      timeText = `${h}h ago`;
    }
  }
  return {
    isLive: false,
    badge: "Ended",
    timeText,
    sortKey: 2,
    startsAt: event.startTime,
  };
}

export function processEvents(
  eventTypes: Array<{
    internalName: string;
    label: string;
    description: string;
  }>,
  liveEventsData: LiveEvent[]
): Array<
  VipEvent & {
    _live?: {
      isLive: boolean;
      badge: string;
      timeText: string;
      sortKey: number;
    };
  }
> {
  return eventTypes
    .map((eventType) => {
      const matches = liveEventsData.filter(
        (le) => le.type === eventType.internalName
      );
      let chosen = matches.find((e) => {
        const now = Date.now();
        const hasTZS = /Z|[+-]\d{2}:\d{2}$/.test(e.startTime || "");
        const s = new Date(
          hasTZS ? e.startTime : (e.startTime || "") + "Z"
        ).getTime();
        const eHasTZ = e.endTime ? /Z|[+-]\d{2}:\d{2}$/.test(e.endTime) : true;
        const end = e.endTime
          ? new Date(eHasTZ ? e.endTime : e.endTime + "Z").getTime()
          : s + 3 * 60 * 60 * 1000;
        return now >= s && now <= end;
      });
      if (!chosen && matches.length > 0) {
        const nowMs = Date.now();
        const withMs = (x: LiveEvent) => {
          const hasTz = /Z|[+-]\d{2}:\d{2}$/.test(x.startTime || "");
          return new Date(
            hasTz ? x.startTime : (x.startTime || "") + "Z"
          ).getTime();
        };
        const future = matches
          .filter((m) => withMs(m) > nowMs)
          .sort((a, b) => withMs(a) - withMs(b));
        if (future.length > 0) {
          chosen = future[0];
        } else {
          chosen = matches.sort((a, b) => withMs(b) - withMs(a))[0];
        }
      }
      const now = Date.now();
      let sortKey = 99;
      let badge = "Not live";
      let timeText = "TBA";
      if (chosen) {
        const hasTZS = /Z|[+-]\d{2}:\d{2}$/.test(chosen.startTime || "");
        const s = new Date(
          hasTZS ? chosen.startTime : (chosen.startTime || "") + "Z"
        ).getTime();
        const eHasTZ = chosen.endTime
          ? /Z|[+-]\d{2}:\d{2}$/.test(chosen.endTime)
          : true;
        const end = chosen.endTime
          ? new Date(eHasTZ ? chosen.endTime : chosen.endTime + "Z").getTime()
          : s + 3 * 60 * 60 * 1000;
        if (now >= s && now <= end) {
          const mins = Math.max(0, Math.round((now - s) / 60000));
          const hours = Math.floor(mins / 60);
          badge = "Live now";
          timeText =
            mins < 60
              ? `started ${mins}m ago`
              : hours >= 24
              ? (() => {
                  const d = Math.floor(hours / 24);
                  const rh = hours % 24;
                  return rh ? `started ${d}d ${rh}h ago` : `started ${d}d ago`;
                })()
              : `started ${hours}h ago`;
          sortKey = 0;
        } else if (now < s) {
          const mins = Math.max(0, Math.round((s - now) / 60000));
          const hours = Math.floor(mins / 60);
          badge = "Upcoming";
          if (mins < 60) {
            timeText = `in ${mins}m`;
          } else if (hours >= 24) {
            const d = Math.floor(hours / 24);
            const rh = hours % 24;
            timeText = rh ? `in ${d}d ${rh}h` : `in ${d}d`;
          } else {
            const m = mins % 60;
            timeText = m ? `in ${hours}h ${m}m` : `in ${hours}h`;
          }
          sortKey = 1;
        } else {
          const mins = Math.round((now - end) / 60000);
          const hours = Math.floor(mins / 60);
          badge = "Ended";
          if (mins < 60) {
            timeText = `${mins}m ago`;
          } else if (hours >= 24) {
            const d = Math.floor(hours / 24);
            const rh = hours % 24;
            timeText = rh ? `${d}d ${rh}h ago` : `${d}d ago`;
          } else {
            timeText = `${hours}h ago`;
          }
          sortKey = 2;
        }
      }
      let category: VipEvent["category"] = "other";
      if (
        eventType.internalName.includes("rough_rock") ||
        eventType.internalName.includes("rough") ||
        eventType.internalName.includes("slab")
      ) {
        category = "rough_rock";
      } else if (
        eventType.internalName.includes("machine") ||
        eventType.internalName.includes("tool")
      ) {
        category = "machines";
      } else if (eventType.internalName.includes("agate")) {
        category = "agate";
      }
      const record = {
        id: eventType.internalName,
        name: eventType.label,
        startsAt: chosen?.startTime,
        description: eventType.description,
        zoomJoinUrl: "#",
        category,
        _live: { isLive: sortKey === 0, badge, timeText, sortKey },
      };
      return record;
    })
    .sort((a, b) => {
      const ak = a._live?.sortKey ?? 99;
      const bk = b._live?.sortKey ?? 99;
      if (ak !== bk) return ak - bk;
      const at = a.startsAt
        ? new Date(
            /Z|[+-]\d{2}:\d{2}$/.test(a.startsAt)
              ? a.startsAt
              : a.startsAt + "Z"
          ).getTime()
        : 0;
      const bt = b.startsAt
        ? new Date(
            /Z|[+-]\d{2}:\d{2}$/.test(b.startsAt)
              ? b.startsAt
              : b.startsAt + "Z"
          ).getTime()
        : 0;
      if (ak === 1) return at - bt;
      if (ak === 2) return bt - at;
      return at - bt;
    });
}
