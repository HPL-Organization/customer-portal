import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
  }
);

function toTitleLabel(type: string) {
  return type
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null as any);

  const {
    id: bodyId,
    type,
    date,
    startTime,
    endTime,
    isEnded,
    targetRevenue,
    totalSale,
    averageDiscount,
    zoomMeetingId,
    counts,
    label,
    description,
    category,
    imageUrl,
  } = body || {};

  if (!type || !date || !startTime || !endTime) {
    return NextResponse.json(
      {
        success: false,
        message: "type, date, startTime, and endTime are required",
      },
      { status: 400 }
    );
  }

  const id = bodyId ?? crypto.randomUUID();
  const effectiveLabel = label ?? toTitleLabel(type);
  const effectiveDescription = description ?? `This is ${effectiveLabel}`;

  const { data, error } = await supabase
    .from("live_events")
    .insert({
      id,
      type,
      date,
      start_time: startTime,
      end_time: endTime,
      is_ended: isEnded ?? false,
      target_revenue: targetRevenue ?? null,
      total_sale: totalSale ?? null,
      average_discount: averageDiscount ?? null,
      zoom_meeting_id: zoomMeetingId ?? null,
      counts: counts ?? {},
      label: effectiveLabel,
      description: effectiveDescription,
      category: category ?? "EVENT_TYPE",
      image_url: imageUrl ?? null,
    })
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
    .single();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Failed to create event",
        error: error.message,
        details: error.details ?? null,
        hint: error.hint ?? null,
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      success: true,
      event: {
        id: data.id,
        type: data.type,
        date: data.date,
        startTime: data.start_time,
        endTime: data.end_time,
        isEnded: data.is_ended,
        targetRevenue: data.target_revenue,
        totalSale: data.total_sale,
        averageDiscount: data.average_discount,
        zoomMeetingId: data.zoom_meeting_id,
        counts: data.counts,
        label: data.label,
        description: data.description,
        category: data.category ?? "EVENT_TYPE",
        imageUrl: data.image_url,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    },
    { status: 201 }
  );
}
