"use server";

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type TrackingDetail = { number: string; carrier: string; url: string };

type FulfillmentRow = {
  fulfillment_id: number;
  tran_id: string | null;
  trandate: string | null;
  customer_id: number | null;
  ship_status: string | null;
  status: string | null;
  created_from_so_id: number | null;
  created_from_so_tranid: string | null;
  tracking: string | null;
  tracking_urls: string[] | null;
  tracking_details: TrackingDetail[] | null;
};

type FulfillmentLineRow = {
  fulfillment_id: number;
  line_no: number;
  item_id: number | null;
  item_sku: string | null;
  item_display_name: string | null;
  quantity: number;
  serial_numbers: string[] | null;
  comments: string[] | null;
};

export async function GET(req: NextRequest) {
  const customerId = req.nextUrl.searchParams.get("customerId");
  if (!customerId) {
    return new Response(JSON.stringify({ error: "Missing customerId" }), {
      status: 400,
    });
  }

  const numericId = Number(customerId);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return new Response(JSON.stringify({ error: "Invalid customerId" }), {
      status: 400,
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const fRes = await supabase
      .from("fulfillments")
      .select(
        "fulfillment_id, tran_id, trandate, customer_id, ship_status, status, created_from_so_id, created_from_so_tranid, tracking, tracking_urls, tracking_details"
      )
      .eq("customer_id", numericId)
      .is("ns_deleted_at", null)
      .order("trandate", { ascending: false });

    if (fRes.error) {
      return new Response(
        JSON.stringify({ error: "Failed to load fulfillments" }),
        { status: 500 }
      );
    }

    const ffsData = (fRes.data ?? []) as any[];
    if (ffsData.length === 0) {
      return new Response(JSON.stringify({ fulfillments: [] }), {
        status: 200,
      });
    }

    const ffs: FulfillmentRow[] = ffsData.map((r) => ({
      fulfillment_id: Number(r.fulfillment_id),
      tran_id: r.tran_id ?? null,
      trandate: r.trandate ?? null,
      customer_id: r.customer_id != null ? Number(r.customer_id) : null,
      ship_status: r.ship_status ?? null,
      status: r.status ?? null,
      created_from_so_id:
        r.created_from_so_id != null ? Number(r.created_from_so_id) : null,
      created_from_so_tranid: r.created_from_so_tranid ?? null,
      tracking: r.tracking ?? null,
      tracking_urls: Array.isArray(r.tracking_urls)
        ? (r.tracking_urls as string[])
        : r.tracking_urls ?? null,
      tracking_details: Array.isArray(r.tracking_details)
        ? (r.tracking_details as TrackingDetail[])
        : r.tracking_details ?? null,
    }));

    const ids = ffs.map((r) => r.fulfillment_id);

    const lRes = await supabase
      .from("fulfillment_lines")
      .select(
        "fulfillment_id, line_no, item_id, item_sku, item_display_name, quantity, serial_numbers, comments"
      )
      .in("fulfillment_id", ids)
      .order("line_no", { ascending: true });

    if (lRes.error) {
      return new Response(
        JSON.stringify({ error: "Failed to load fulfillment lines" }),
        { status: 500 }
      );
    }

    const linesData = (lRes.data ?? []) as any[];
    const lines: FulfillmentLineRow[] = linesData.map((ln) => ({
      fulfillment_id: Number(ln.fulfillment_id),
      line_no: Number(ln.line_no),
      item_id: ln.item_id != null ? Number(ln.item_id) : null,
      item_sku: ln.item_sku ?? null,
      item_display_name: ln.item_display_name ?? null,
      quantity: Number(ln.quantity ?? 0),
      serial_numbers: Array.isArray(ln.serial_numbers)
        ? (ln.serial_numbers as string[])
        : ln.serial_numbers ?? null,
      comments: Array.isArray(ln.comments)
        ? (ln.comments as string[])
        : ln.comments ?? null,
    }));

    const linesByFid = new Map<number, FulfillmentLineRow[]>();
    for (const ln of lines) {
      const fid = ln.fulfillment_id;
      if (!linesByFid.has(fid)) linesByFid.set(fid, []);
      linesByFid.get(fid)!.push(ln);
    }

    const fulfillmentsWithItems = ffs.map((ff) => {
      const fid = ff.fulfillment_id;
      const orderNumber = normalizeSOTranId(ff.created_from_so_tranid);
      const fulfillmentNumber = ff.tran_id ?? "";
      const number = orderNumber
        ? `${orderNumber} • ${fulfillmentNumber}`
        : fulfillmentNumber;

      const childLines = linesByFid.get(fid) || [];
      const items = childLines.map((ln) => ({
        sku: ln.item_sku ?? null,
        productName: ln.item_display_name ?? ln.item_sku ?? null,
        quantity: Math.abs(Number(ln.quantity ?? 0)),
        serialNumbers: Array.from(
          new Set((ln.serial_numbers ?? []) as string[])
        ),
        comments: Array.from(new Set((ln.comments ?? []) as string[])),
        tracking: ff.tracking ?? null,
      }));

      const trackingUrls = (ff.tracking_urls ?? []) as string[];
      const trackingDetails = (ff.tracking_details ?? []) as TrackingDetail[];

      return {
        id: fid,
        number,
        orderNumber,
        fulfillmentNumber,
        shippedAt: ff.trandate,
        shipStatus: ff.ship_status ?? "",
        status: ff.status ?? "",
        tracking: ff.tracking ?? "",
        trackingUrls,
        trackingDetails,
        salesOrderId: ff.created_from_so_id ?? null,
        salesOrderTranId: ff.created_from_so_tranid ?? null,
        items,
      };
    });

    return new Response(
      JSON.stringify({ fulfillments: fulfillmentsWithItems }),
      { status: 200 }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Failed to fetch fulfillments" }),
      { status: 500 }
    );
  }
}

function normalizeSOTranId(raw: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/\bSO[-\d]+\b/i);
  if (m) return m[0].toUpperCase();
  const cleaned = s.replace(/sales\s*order\s*#?/i, "").trim();
  return cleaned || s;
}
