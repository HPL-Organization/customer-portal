import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const NETSUITE_UI_HOST = (
  process.env.NETSUITE_UI_HOST || `${NETSUITE_ACCOUNT_ID}.app.netsuite.com`
)
  .replace(/^https?:\/\//, "")
  .trim();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const NS_UI_BASE = `https://${NETSUITE_UI_HOST}`;
const salesOrderUrl = (id: number | string) =>
  `${NS_UI_BASE}/app/accounting/transactions/salesord.nl?whence=&id=${id}`;
const invoiceUrl = (id: number | string) =>
  `${NS_UI_BASE}/app/accounting/transactions/custinvc.nl?whence=&id=${id}`;

export async function GET(req: NextRequest) {
  const soIdParam = req.nextUrl.searchParams.get("internalId");
  const customerIdParam = req.nextUrl.searchParams.get("customerId");

  if (!soIdParam && !customerIdParam) {
    return new Response(
      JSON.stringify({ error: "Provide customerId or internalId" }),
      { status: 400 }
    );
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let customerId: number | null = null;
    let invoiceIds: number[] = [];

    if (customerIdParam) {
      customerId = Number(customerIdParam);
      if (!Number.isFinite(customerId)) {
        return new Response(JSON.stringify({ error: "Invalid customerId" }), {
          status: 400,
        });
      }
      const { data: invs, error } = await supabase
        .from("invoices")
        .select("invoice_id")
        .eq("customer_id", customerId)
        .is("ns_deleted_at", null)
        .order("trandate", { ascending: false });
      if (error) throw error;
      invoiceIds = (invs || []).map((r) => Number(r.invoice_id));
    } else {
      const soId = Number(soIdParam);
      if (!Number.isFinite(soId)) {
        return new Response(JSON.stringify({ error: "Invalid internalId" }), {
          status: 400,
        });
      }
      const { data: invsBySo, error: e1 } = await supabase
        .from("invoices")
        .select("invoice_id, customer_id")
        .eq("created_from_so_id", soId)
        .is("ns_deleted_at", null);
      if (e1) throw e1;
      invoiceIds = (invsBySo || []).map((r) => Number(r.invoice_id));
      customerId = invsBySo?.[0]?.customer_id ?? null;
    }

    const deposits: any[] = [];
    const unappliedDeposits: any[] = [];

    if (invoiceIds.length === 0) {
      return new Response(
        JSON.stringify({
          invoices: [],
          deposits,
          unappliedDeposits,
          customerId,
        }),
        { status: 200 }
      );
    }

    const { data: headers, error: eH } = await supabase
      .from("invoices")
      .select("*")
      .in("invoice_id", invoiceIds)
      .is("ns_deleted_at", null);
    if (eH) throw eH;

    const { data: lines, error: eL } = await supabase
      .from("invoice_lines")
      .select("*")
      .in("invoice_id", invoiceIds);
    if (eL) throw eL;

    const { data: payments, error: eP } = await supabase
      .from("invoice_payments")
      .select("*")
      .in("invoice_id", invoiceIds);
    if (eP) throw eP;

    const linesByInv = new Map<number, any[]>();
    for (const ln of lines || []) {
      const id = Number(ln.invoice_id);
      if (!linesByInv.has(id)) linesByInv.set(id, []);
      linesByInv.get(id)!.push({
        itemId: ln.item_id,
        itemName: ln.item_sku,
        itemDisplayName: ln.item_display_name ?? ln.item_sku,
        quantity: Number(ln.quantity ?? 0),
        rate: Number(ln.rate ?? 0),
        amount: Number(ln.amount ?? 0),
        description: ln.description,
        comment: ln.comment,
      });
    }

    const paymentsByInv = new Map<number, any[]>();
    for (const p of payments || []) {
      const id = Number(p.invoice_id);
      if (!paymentsByInv.has(id)) paymentsByInv.set(id, []);
      paymentsByInv.get(id)!.push({
        paymentId: p.payment_id,
        tranId: p.tran_id,
        paymentDate: p.payment_date,
        amount: Number(p.amount ?? 0),
        status: p.status,
        paymentOption: p.payment_option,
      });
    }

    const headersMap = new Map<number, any>();
    for (const h of headers || []) {
      headersMap.set(Number(h.invoice_id), h);
    }

    const invoicesOut = (headers || [])
      .sort(
        (a, b) =>
          new Date(b.trandate || 0).getTime() -
          new Date(a.trandate || 0).getTime()
      )
      .map((h) => {
        const id = Number(h.invoice_id);
        const pmts = paymentsByInv.get(id) || [];
        const amountPaid = Number(
          h.amount_paid ?? pmts.reduce((s, x) => s + (Number(x.amount) || 0), 0)
        );
        const total = Number(h.total ?? 0);
        const amountRemaining = Number(
          h.amount_remaining ?? Math.max(0, total - amountPaid)
        );
        return {
          invoiceId: id,
          tranId: h.tran_id ?? null,
          trandate: h.trandate ?? null,
          total,
          taxTotal: Number(h.tax_total ?? 0),
          amountPaid,
          amountRemaining,
          customerId: h.customer_id ?? customerId ?? null,
          createdFromSoId: h.created_from_so_id ?? null,
          createdFromSoTranId: h.created_from_so_tranid ?? null,
          createdFromSoUrl: h.created_from_so_id
            ? salesOrderUrl(h.created_from_so_id)
            : null,
          lines: linesByInv.get(id) || [],
          payments: pmts,
          netsuiteUrl: h.netsuite_url ?? invoiceUrl(id),
          payment_processing: (h as any).payment_processing === true,
        };
      });

    return new Response(
      JSON.stringify({
        invoices: invoicesOut,
        deposits,
        unappliedDeposits,
        customerId,
      }),
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Supabase-backed invoices GET failed:", err?.message || err);
    return new Response(JSON.stringify({ error: "Could not load invoices" }), {
      status: 500,
    });
  }
}
