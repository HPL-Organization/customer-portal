// src/app/api/supabase/events/get/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
  }
);

export async function GET(_req: NextRequest) {
  const { data, error } = await supabase
    .from("live_events")
    .select(
      `
        id,
        type,
        date,
        start_time,
        end_time,
        is_ended,
        target_revenue,
        total_sale,
        average_discount,
        zoom_meeting_id,
        counts,
        label,
        description,
        category,
        image_url,
        created_at,
        updated_at
      `
    )
    .order("date", { ascending: true });

  if (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Failed to fetch events",
      },
      { status: 500 }
    );
  }

  logger.info("Events data", { data });

  const rows = data ?? [];

  const events = rows.map((row) => ({
    id: row.id as string,
    type: row.type as string,
    date: row.date as string,
    startTime: row.start_time as string,
    endTime: row.end_time as string,
    isEnded: row.is_ended as boolean,
    targetRevenue: row.target_revenue as number | null,
    totalSale: row.total_sale as number | null,
    averageDiscount: row.average_discount as number | null,
    zoomMeetingId: row.zoom_meeting_id as number | null,
    counts: row.counts, // jsonb, use as-is
    label: row.label as string | null,
    description: row.description as string | null,
    category: (row.category as string | null) ?? "EVENT_TYPE",
    imageUrl: row.image_url as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));

  logger.info("Events", { events });

  const typeMap = new Map<
    string,
    {
      internalName: string;
      label: string;
      description: string;
      category: string;
      imageUrl: string | null;
      createdAt: string | null;
      updatedAt: string | null;
    }
  >();

  for (const ev of events) {
    const key = ev.type;
    if (typeMap.has(key)) continue;

    typeMap.set(key, {
      internalName: ev.type,
      label:
        ev.label ??
        ev.type
          .split("_")
          .filter(Boolean)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" "),
      description:
        ev.description ??
        `This is ${
          ev.label ??
          ev.type
            .split("_")
            .filter(Boolean)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ")
        }`,
      category: ev.category ?? "EVENT_TYPE",
      imageUrl: ev.imageUrl ?? null,
      createdAt: ev.createdAt ?? null,
      updatedAt: ev.updatedAt ?? null,
    });
  }

  const eventTypes = Array.from(typeMap.values());

  logger.info("Event types", { eventTypes });

  return NextResponse.json(
    {
      success: true,
      eventTypes,
      events,
    },
    { status: 200 }
  );
}
