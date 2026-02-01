// app/api/supabase/get-invoice-line-etas/route.ts
/**
 * Returns per-line item-in-stock ETA for a backordered invoice.
 * Uses invoice header is_backordered + created_from_so_id, then matches ETAs by item_id and adds 14 days.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type DbInvoice = {
  invoice_id: number;
  customer_id: number;
  created_from_so_id: number | null;
  ns_deleted_at: string | null;
  is_backordered: boolean | null;
};

type DbInvoiceLine = {
  invoice_id: number;
  line_no: number;
  item_id: number | null;
};

type DbSoLineEta = {
  item_id: number;
  eta_date: string | null;
};

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !serviceKey) throw new Error("Missing Supabase env vars");
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

function parseDateFlexible(s: string): Date | null {
  const raw = String(s ?? "").trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T00:00:00Z`);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    const yyyy = Number(m[3]);
    if (!Number.isFinite(mm) || !Number.isFinite(dd) || !Number.isFinite(yyyy))
      return null;
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    return Number.isFinite(d.getTime()) ? d : null;
  }

  return null;
}

function formatUsDate(d: Date) {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return `${mm}/${dd}/${yyyy}`;
}

export async function GET(req: NextRequest) {
  const customerIdRaw = req.nextUrl.searchParams.get("customerId");
  const invoiceIdRaw = req.nextUrl.searchParams.get("invoiceId");

  const customerId = Number(customerIdRaw);
  const invoiceId = Number(invoiceIdRaw);

  if (!customerIdRaw || !Number.isFinite(customerId) || customerId <= 0) {
    return NextResponse.json(
      { error: "Missing or invalid customerId" },
      { status: 400 }
    );
  }
  if (!invoiceIdRaw || !Number.isFinite(invoiceId) || invoiceId <= 0) {
    return NextResponse.json(
      { error: "Missing or invalid invoiceId" },
      { status: 400 }
    );
  }

  const supabase = getServiceSupabase();

  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .select(
      "invoice_id, customer_id, created_from_so_id, ns_deleted_at, is_backordered"
    )
    .eq("invoice_id", invoiceId)
    .eq("customer_id", customerId)
    .is("ns_deleted_at", null)
    .maybeSingle();

  if (invErr)
    return NextResponse.json({ error: invErr.message }, { status: 500 });
  if (!inv) return NextResponse.json({ rows: [] }, { status: 200 });

  const invRow = inv as unknown as DbInvoice;

  if (!invRow.is_backordered)
    return NextResponse.json({ rows: [] }, { status: 200 });

  const soId = invRow.created_from_so_id ?? null;
  if (!soId) return NextResponse.json({ rows: [] }, { status: 200 });

  const { data: lines, error: linesErr } = await supabase
    .from("invoice_lines")
    .select("invoice_id, line_no, item_id")
    .eq("invoice_id", invoiceId)
    .order("line_no", { ascending: true });

  if (linesErr)
    return NextResponse.json({ error: linesErr.message }, { status: 500 });

  const lineRows = (Array.isArray(lines)
    ? lines
    : []) as unknown as DbInvoiceLine[];
  const eligible = lineRows.filter((l) => l.item_id != null);

  if (!eligible.length) return NextResponse.json({ rows: [] }, { status: 200 });

  const itemIds = Array.from(
    new Set(eligible.map((l) => Number(l.item_id)).filter(Number.isFinite))
  );
  if (!itemIds.length) return NextResponse.json({ rows: [] }, { status: 200 });

  const { data: etaRows, error: etaErr } = await supabase
    .from("eta_so_line_etas")
    .select("item_id, eta_date")
    .eq("customer_id", customerId)
    .eq("so_id", soId)
    .in("item_id", itemIds)
    .is("ns_deleted_at", null);

  if (etaErr)
    return NextResponse.json({ error: etaErr.message }, { status: 500 });

  const rows = (Array.isArray(etaRows)
    ? etaRows
    : []) as unknown as DbSoLineEta[];

  const etaByItem = new Map<number, { d: Date; formatted: string }>();
  for (const r of rows) {
    if (!r?.eta_date) continue;
    const base = parseDateFlexible(r.eta_date);
    if (!base) continue;

    const inStock = new Date(base.getTime() + 14 * 24 * 60 * 60 * 1000);
    const itemId = Number(r.item_id);
    if (!Number.isFinite(itemId)) continue;

    const prev = etaByItem.get(itemId);
    if (!prev || inStock.getTime() < prev.d.getTime()) {
      etaByItem.set(itemId, { d: inStock, formatted: formatUsDate(inStock) });
    }
  }

  const itemsWithAnyEtaRow = new Set<number>();
  for (const r of rows) {
    const itemId = Number(r?.item_id);
    if (Number.isFinite(itemId)) itemsWithAnyEtaRow.add(itemId);
  }

  const out = eligible
    .filter((l) => {
      const itemId = Number(l.item_id);
      return Number.isFinite(itemId) && itemsWithAnyEtaRow.has(itemId);
    })
    .map((l) => {
      const itemId = Number(l.item_id);
      const lineNo = Number(l.line_no);
      const eta = etaByItem.get(itemId)?.formatted ?? null;
      return { item_id: itemId, line_no: lineNo, item_in_stock_eta: eta };
    });

  return NextResponse.json({ rows: out }, { status: 200 });
}
