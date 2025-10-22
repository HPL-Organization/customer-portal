"use server";

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  const ts = new Date().toISOString();
  const url = new URL(req.url);
  const soIdRaw = url.searchParams.get("soId");
  const debug = url.searchParams.get("debug") === "1";
  const started = Date.now();

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error(
      `[${ts}] [order-tracking-by-so-id] Missing Supabase env(s). hasUrl=${!!SUPABASE_URL} hasKey=${!!SUPABASE_SERVICE_KEY}`
    );
    return new Response(
      JSON.stringify({ error: "Server not configured (Supabase env missing)" }),
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!soIdRaw) {
    console.warn(`[${ts}] [order-tracking-by-so-id] Missing soId`);
    return new Response(JSON.stringify({ error: "Missing soId" }), {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const soIdNum = Number(soIdRaw);
  const looksNumeric = Number.isFinite(soIdNum);

  console.log(
    `[${ts}] [order-tracking-by-so-id] soId="${soIdRaw}" looksNumeric=${looksNumeric} parsed=${
      looksNumeric ? soIdNum : "NaN"
    }`
  );

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Use real column names from your schema
    // public.fulfillments:
    // fulfillment_id (pk), tran_id, trandate, customer_id, ship_status, status,
    // created_from_so_id, created_from_so_tranid, tracking, tracking_urls, tracking_details, ns_deleted_at
    const selectCols = [
      "fulfillment_id",
      "tran_id",
      "trandate",
      "ship_status",
      "status",
      "created_from_so_id",
      "created_from_so_tranid",
      "tracking",
      "tracking_urls",
      "tracking_details",
      "ns_deleted_at",
    ].join(",");

    // If your column is BIGINT we can compare numerically.
    // If it were text, you could add a .or() string fallback, but not needed if BIGINT.
    const { data, error } = await supabase
      .from("fulfillments")
      .select(selectCols)
      .eq("created_from_so_id", looksNumeric ? soIdNum : soIdRaw)
      .is("ns_deleted_at", null)
      .order("trandate", { ascending: false });

    const duration = Date.now() - started;

    if (error) {
      console.error(
        `[${ts}] [order-tracking-by-so-id] Supabase error after ${duration}ms`,
        {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        }
      );
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      });
    }

    console.log(
      `[${ts}] [order-tracking-by-so-id] rows=${
        data?.length ?? 0
      } durationMs=${duration}`,
      data && data.length
        ? {
            sample: {
              fulfillment_id: data[0].fulfillment_id,
              so_id: data[0].created_from_so_id,
            },
          }
        : {}
    );

    // Shape payload for FulfillmentPeek
    const payload = (data || []).map((r: any) => {
      // Build a minimal "items" list so UI can show tracking chips.
      const items: Array<{ tracking?: string }> = [];
      if (r.tracking && String(r.tracking).trim()) {
        items.push({ tracking: String(r.tracking).trim() });
      }
      // If you later want to surface per-line trackings from tracking_details, add them here.

      return {
        id: r.fulfillment_id,
        orderNumber: r.created_from_so_tranid || null, // SO number (display)
        fulfillmentNumber: r.tran_id || null, // fulfillment transaction number
        status: r.status || "",
        shipStatus: r.ship_status || "",
        shippedAt: r.trandate || null, // date
        items, // contains tracking if present
      };
    });

    const body = debug
      ? {
          payload,
          debug: {
            soId: soIdRaw,
            parsedNumber: looksNumeric ? soIdNum : null,
            rows: payload.length,
            durationMs: duration,
          },
        }
      : payload;

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    const duration = Date.now() - started;
    console.error(
      `[${ts}] [order-tracking-by-so-id] Unexpected error after ${duration}ms`,
      e?.message || e
    );
    return new Response(
      JSON.stringify({
        error: "Unexpected error",
        ...(debug
          ? { message: e?.message ?? null, stack: e?.stack ?? null }
          : {}),
      }),
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
