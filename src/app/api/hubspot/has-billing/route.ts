// src/app/api/hubspot/has-billing/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getContactById } from "@/lib/hubspot/hubspotCentral";

function hasValue(v?: string | null) {
  return typeof v === "string" && v.trim().length > 0;
}

export async function GET(req: NextRequest) {
  const contactId = req.nextUrl.searchParams.get("contactId");
  if (!contactId) {
    return NextResponse.json({ error: "contactId required" }, { status: 400 });
  }

  try {
    let contact: any = null;

    try {
      contact = await getContactById(String(contactId));
    } catch (e: any) {
      const status = e?.response?.status ?? e?.status ?? null;
      const msg = String(e?.message || "");
      const is404 =
        status === 404 ||
        /(^|[^0-9])404([^0-9]|$)/.test(msg) ||
        /not\s*found/i.test(msg);

      if (is404) {
        return NextResponse.json({ hasBilling: false }, { status: 200 });
      }
      throw e;
    }

    const p = (contact?.properties ?? contact) || {};
    const hasBilling =
      hasValue(p.address) &&
      hasValue(p.city) &&
      hasValue(p.state) &&
      hasValue(p.zip) &&
      hasValue(p.country);

    return NextResponse.json({ hasBilling: Boolean(hasBilling) });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to check HubSpot contact" },
      { status: 500 }
    );
  }
}
