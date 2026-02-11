// src/app/api/versapay/process-sale/route.ts
import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { getServerSupabase } from "@/lib/supabase/server";

const VP_API_BASE = `${process.env.VERSAPAY_BASE_URL}/api/v2`;

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

function pickText(v?: string | null, fallback?: string) {
  if (typeof v !== "string") return fallback;
  const t = v.trim();
  return t ? t : fallback;
}

function buildAddressesFromSupabase(row: any) {
  const first = pickText(row?.first_name);
  const last = pickText(row?.last_name);
  const email = pickText(row?.email);
  const phone = pickText(row?.phone) || pickText(row?.mobile);

  const billing = {
    contactFirstName: pickText(first, "Customer"),
    contactLastName: pickText(last, "Name"),
    companyName: undefined as string | undefined,
    address1: pickText(row?.billing_address1),
    address2: pickText(row?.billing_address2),
    city: pickText(row?.billing_city),
    stateOrProvince: pickText(row?.billing_state),
    postCode: pickText(row?.billing_zip),
    country: normalizeCountry(pickText(row?.billing_country)),
    email: pickText(email),
    phone,
  };

  const shipping = {
    contactFirstName: pickText(first, "Customer"),
    contactLastName: pickText(last, "Name"),
    companyName: undefined as string | undefined,
    address1: pickText(row?.shipping_address1, billing.address1),
    address2: pickText(row?.shipping_address2, billing.address2),
    city: pickText(row?.shipping_city, billing.city),
    stateOrProvince: pickText(row?.shipping_state, billing.stateOrProvince),
    postCode: pickText(row?.shipping_zip, billing.postCode),
    country:
      normalizeCountry(pickText(row?.shipping_country)) ?? billing.country,
    email: pickText(email),
    phone,
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
      customerId,
    } = body;

    if (!sessionId || !token || typeof amount !== "number") {
      return NextResponse.json(
        { error: "sessionId, token, and amount are required" },
        { status: 400 }
      );
    }

    const supabase = await getServerSupabase();
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const customerIdNum =
      customerId !== null && customerId !== undefined ? Number(customerId) : null;
    const hasValidCustomerId =
      customerIdNum !== null &&
      !Number.isNaN(customerIdNum) &&
      customerIdNum !== -1;

    const selectFields = `
      first_name,
      last_name,
      email,
      phone,
      mobile,
      shipping_address1,
      shipping_address2,
      shipping_city,
      shipping_state,
      shipping_zip,
      shipping_country,
      billing_address1,
      billing_address2,
      billing_city,
      billing_state,
      billing_zip,
      billing_country
    `;

    let row: any = null;
    if (hasValidCustomerId) {
      const { data, error } = await supabase
        .from("customer_information")
        .select(selectFields)
        .eq("customer_id", customerIdNum)
        .limit(1)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      row = data ?? null;
    }

    if (!row) {
      const { data, error } = await supabase
        .from("customer_information")
        .select(selectFields)
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      row = data ?? null;
    }

    const { billing, shipping } = row
      ? buildAddressesFromSupabase(row)
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
