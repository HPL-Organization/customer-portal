// src/app/api/netsuite/delete-token/route.ts
import { NextRequest } from "next/server";
import { getValidToken } from "@/lib/netsuite/token";

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
    return new Response(JSON.stringify(data), { status: 200 });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message || String(err) }),
      { status: 500 }
    );
  }
}
