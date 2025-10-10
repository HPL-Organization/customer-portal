import { NextRequest } from "next/server";
import axios from "axios";
import { getValidToken } from "../../../../lib/netsuite/token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

export async function POST(req: NextRequest) {
  try {
    const { name, email, middleName } = await req.json();

    if (!name || !email) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Name and email are required",
        }),
        { status: 400 }
      );
    }

    const [firstName, ...rest] = name.trim().split(" ");
    const lastName = rest.join(" ") || firstName;

    const accessToken = await getValidToken();

    const payload: Record<string, any> = {
      entityId: email,
      subsidiary: { id: "2" },
      companyName: name,
      firstName,
      lastName,
      email,
    };

    if (middleName) payload.middleName = middleName;

    const response = await axios.post(
      `${BASE_URL}/record/v1/customer`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        validateStatus: () => true,
      }
    );

    let internalId: string | null = null;
    if (response.data?.id) internalId = response.data.id;
    else if (response.headers.location) {
      const match = response.headers.location.match(/customer\/(\d+)/);
      if (match) internalId = match[1];
    }

    return new Response(
      JSON.stringify({
        success: true,
        id: internalId,
        result: response.data || null,
      }),
      { status: 200 }
    );
  } catch (err: any) {
    console.error(
      "Error creating simple NetSuite customer:",
      err?.response?.data || err.message
    );
    return new Response(
      JSON.stringify({
        success: false,
        error: err?.response?.data || err.message,
      }),
      { status: 500 }
    );
  }
}
