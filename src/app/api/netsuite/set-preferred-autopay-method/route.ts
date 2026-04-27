import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const NS_WRITES_URL =
  process.env.NS_WRITES_URL || "https://netsuite-writes.onrender.com";
const NS_WRITES_ADMIN_BEARER = process.env.NS_WRITES_ADMIN_BEARER || "test";

type RequestBody = {
  customerId?: number | string;
  instrumentId?: number | string | null;
};

async function updateExpressPayInNetSuite(
  customerId: number,
  instrumentId: string | null,
) {
  const netsuiteExpressPayValue =
    instrumentId == null || instrumentId === "" ? "" : instrumentId;
  const res = await fetch(
    `${NS_WRITES_URL.replace(/\/$/, "")}/api/netsuite/update-customer`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NS_WRITES_ADMIN_BEARER}`,
      },
      body: JSON.stringify({
        customerInternalId: customerId,
        custentity_hpl_express_pay: netsuiteExpressPayValue,
      }),
    }
  );

  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok || json?.error) {
    const message =
      json?.message || json?.error || `HTTP ${res.status}: ${text}`;
    throw new Error(message);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;
    const customerId = Number(body.customerId);

    if (!Number.isFinite(customerId) || customerId <= 0) {
      return NextResponse.json(
        { success: false, message: "Valid customerId is required" },
        { status: 400 }
      );
    }

    const rawInstrumentId = body.instrumentId;
    const instrumentId =
      rawInstrumentId == null || String(rawInstrumentId).trim() === ""
        ? null
        : String(rawInstrumentId).trim();
    const expressPayUpdatedAt = new Date().toISOString();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const [{ data: methods, error: fetchError }, { data: existingCustomerInfo, error: customerInfoError }] =
      await Promise.all([
        supabase
          .from("payment_instruments")
          .select("instrument_id, ns_deleted_at, netsuite_writes_status")
          .eq("customer_id", customerId),
        supabase
          .from("customer_information")
          .select("customer_id, express_pay, express_pay_updated_at")
          .eq("customer_id", customerId)
          .limit(1)
          .maybeSingle(),
      ]);

    if (fetchError || customerInfoError) {
      return NextResponse.json(
        { success: false, message: "Failed to load payment methods" },
        { status: 500 }
      );
    }

    const activeMethods = (methods || []).filter(
      (row) => !row.ns_deleted_at
    );
    const usableMethods = activeMethods.filter((row) => {
      const status = String(row.netsuite_writes_status || "").toLowerCase();
      return status !== "processing" && status !== "failed";
    });

    if (instrumentId) {
      const selected = usableMethods.find(
        (row) => String(row.instrument_id) === instrumentId
      );
      if (!selected) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Selected payment method is unavailable for back-in-stock autopay",
          },
          { status: 400 }
        );
      }
    }

    try {
      await updateExpressPayInNetSuite(customerId, instrumentId);
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Failed to update Express Pay in NetSuite",
        },
        { status: 502 }
      );
    }

    const { error: persistError } = await supabase
      .from("customer_information")
      .upsert(
        {
          customer_id: customerId,
          express_pay: instrumentId,
          express_pay_updated_at: expressPayUpdatedAt,
        },
        { onConflict: "customer_id" }
      );

    if (persistError) {
      return NextResponse.json(
        { success: false, message: "Failed to persist Express Pay" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        instrumentId,
        previousInstrumentId:
          existingCustomerInfo?.express_pay == null
            ? null
            : String(existingCustomerInfo.express_pay),
        expressPayUpdatedAt,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { success: false, message: "Failed to update autopay preference" },
      { status: 500 }
    );
  }
}
