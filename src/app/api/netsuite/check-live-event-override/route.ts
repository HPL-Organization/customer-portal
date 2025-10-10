import { NextRequest, NextResponse } from "next/server";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/record/v1`;

async function getValidToken(): Promise<string> {
  const { getValidToken: real } = await import("@/lib/netsuite/token");
  return real();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customerId");

    if (!customerId) {
      return NextResponse.json(
        { error: "Missing required query param: customerId" },
        { status: 400 }
      );
    }

    const token = await getValidToken();

    const url = `${BASE_URL}/customer/${encodeURIComponent(
      customerId
    )}?fields=custentity_hpl_allow_le_override`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      // avoid caching in edge/CDN layers
      cache: "no-store",
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      return NextResponse.json(
        {
          error: "Failed to fetch customer",
          status: resp.status,
          details: data,
        },
        { status: resp.status || 500 }
      );
    }

    let raw = (data as any)?.custentity_hpl_allow_le_override;
    if (raw === "T") raw = true;
    if (raw === "F") raw = false;

    const override =
      typeof raw === "boolean" ? raw : String(raw).toLowerCase() === "true";

    return NextResponse.json({
      customerId,
      override,
      raw,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "Unexpected error",
        message: err?.message || String(err),
      },
      { status: 500 }
    );
  }
}
