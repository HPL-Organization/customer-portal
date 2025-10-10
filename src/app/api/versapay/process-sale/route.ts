// src/app/api/versapay/process-sale/route.ts
import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { getContactById } from "@/lib/hubspot/hubspotCentral"; // uses your existing lib

const VP_API_BASE = `${process.env.VERSAPAY_BASE_URL}/api/v2`;

function readProps(contact: any): Record<string, any> {
  if (!contact) return {};
  return contact.properties ?? contact;
}

function pick<T>(
  v: T | undefined | null,
  fallback: T | undefined | null = undefined
): T | undefined {
  return v ?? undefined ?? fallback ?? undefined;
}

function normalizeCountry(v?: string) {
  if (!v) return undefined;
  const s = v.trim();
  if (s.length === 2) return s.toUpperCase();
  const map: Record<string, string> = {
    unitedstates: "US",
    "united states": "US",
    usa: "US",
    canada: "CA",
  };
  const key = s.toLowerCase();
  return map[key] ?? s;
}

function buildAddressesFromHubSpot(contact: any) {
  const p = readProps(contact);

  const first = pick(p.firstname);
  const last = pick(p.lastname);
  const email = pick(p.email);

  // Billing fields (HubSpot default address fields)
  const billing = {
    contactFirstName: pick(first, "Customer"),
    contactLastName: pick(last, "Name"),
    companyName: undefined as string | undefined,
    address1: pick(p.address),
    address2: pick(p.address_line_2),
    city: pick(p.city),
    stateOrProvince: pick(p.state),
    postCode: pick(p.zip),
    country: normalizeCountry(p.country),
    email: pick(email),
    phone: pick(p.phone) || pick(p.mobilephone),
  };

  // Shipping fields (HubSpot shipping_* set)
  const shipping = {
    contactFirstName: pick(first, "Customer"),
    contactLastName: pick(last, "Name"),
    companyName: undefined as string | undefined,
    address1: pick(p.shipping_address, billing.address1),
    address2: pick(p.shipping_address_line_2, billing.address2),
    city: pick(p.shipping_city, billing.city),
    stateOrProvince: pick(p.shipping_state_region, billing.stateOrProvince),
    postCode: pick(p.shipping_postalcode, billing.postCode),
    country: normalizeCountry(p.shipping_country_region) ?? billing.country,
    email: pick(email),
    phone: pick(p.phone) || pick(p.mobilephone),
  };

  return { billing, shipping };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      sessionId, // required
      token, // required
      amount, // required
      capture = true,
      orderNumber,
      currency = "USD",
      customerNumber,
      settlementToken,

      contactId,
      contact: _contactFromClient,
    } = body;

    if (!sessionId || !token || typeof amount !== "number") {
      return NextResponse.json(
        { error: "sessionId, token, and amount are required" },
        { status: 400 }
      );
    }

    let contact = _contactFromClient ?? null;
    if (!contact && contactId) {
      contact = await getContactById(String(contactId));
    }

    const { billing, shipping } = contact
      ? buildAddressesFromHubSpot(contact)
      : {
          billing: {
            contactFirstName: "Test",
            contactLastName: "Buyer",
            companyName: "Example Co",
            address1: "123 Main St",
            city: "Boston",
            stateOrProvince: "MA",
            postCode: "02118",
            country: "US",
            email: "buyer@example.com",
          },
          shipping: {
            contactFirstName: "Test",
            contactLastName: "Buyer",
            companyName: "Example Co",
            address1: "123 Main St",
            city: "Boston",
            stateOrProvince: "MA",
            postCode: "02118",
            country: "US",
            email: "buyer@example.com",
          },
        };

    const billingAddress = { ...billing, ...(body.billingOverride ?? {}) };
    const shippingAddress = { ...shipping, ...(body.shippingOverride ?? {}) };

    console.log(
      "Billing and shipping address actually used",
      billingAddress,
      shippingAddress
    );

    const payload = {
      gatewayAuthorization: {
        apiToken: process.env.VERSAPAY_API_TOKEN!,
        apiKey: process.env.VERSAPAY_API_KEY!,
      },
      customerNumber: customerNumber ?? "CUST-TEST",
      orderNumber: orderNumber ?? `WEB-${Date.now()}`,
      currency,
      billingAddress,
      shippingAddress,
      lines: body.lines ?? [
        {
          type: "Item",
          number: "SKU-TEST",
          description: "Test Item",
          price: amount,
          quantity: 1,
          discount: 0,
        },
      ],
      payment: {
        type: "creditCard",
        token,
        amount,
        capture,
        ...(settlementToken ? { settlementToken } : {}),
      },
    };

    const { data, status } = await axios.post(
      `${VP_API_BASE}/sessions/${sessionId}/sales`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    return NextResponse.json(data, { status: status === 201 ? 201 : 200 });
  } catch (err: any) {
    const status = err?.response?.status ?? 500;
    const details = err?.response?.data ?? { message: err.message };
    return NextResponse.json(
      { error: "Versapay sale failed", details },
      { status }
    );
  }
}
