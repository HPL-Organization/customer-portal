import { NextRequest } from "next/server";
import { getValidToken } from "@/lib/netsuite/token";
import { createClient } from "@supabase/supabase-js";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const ACCOUNT_ID = (
  isSB ? process.env.NETSUITE_ACCOUNT_ID_SB : process.env.NETSUITE_ACCOUNT_ID
)!;
const SCRIPT_ID = 2651;
const DEPLOY_ID = 1;

const RESTLET_URL =
  `https://${ACCOUNT_ID}.restlets.api.netsuite.com/app/site/hosting/restlet.nl` +
  `?script=${encodeURIComponent(SCRIPT_ID)}&deploy=${encodeURIComponent(
    DEPLOY_ID
  )}`;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  try {
    const { instrumentId, customerId, type } = await req.json();
    if (!instrumentId || !customerId) {
      return new Response(
        JSON.stringify({ error: "instrumentId and customerId are required" }),
        { status: 400 }
      );
    }

    const accessToken = await getValidToken();
    const resp = await fetch(RESTLET_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ instrumentId, customerId, type }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: data?.message || resp.statusText }),
        { status: resp.status }
      );
    }

    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const nowIso = new Date().toISOString();
      const { error: delErr } = await supabase
        .from("payment_instruments")
        .update({ ns_deleted_at: nowIso, synced_at: nowIso })
        .eq("customer_id", Number(customerId))
        .eq("instrument_id", String(instrumentId));
      if (delErr) {
        console.error("Supabase tombstone failed", delErr);
      }
    } catch (e) {
      console.error("Supabase tombstone error", e);
    }

    return new Response(JSON.stringify(data), { status: 200 });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || String(err) }),
      { status: 500 }
    );
  }
}
