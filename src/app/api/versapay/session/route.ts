import { NextRequest } from "next/server";
import axios from "axios";

const VP_BASE = (process.env.VERSAPAY_BASE_URL || "").replace(/\/$/, "");
const VP_API_BASE = `${VP_BASE}/api/v2`;

export async function POST(_req: NextRequest) {
  try {
    const payload = {
      gatewayAuthorization: {
        apiKey: process.env.VERSAPAY_API_KEY!,
        apiToken: process.env.VERSAPAY_API_TOKEN!,
      },
      options: {
        wallet: {
          allowAdd: false,
          allowEdit: false,
          allowDelete: false,
          saveByDefault: false,
        },
        paymentTypes: [
          {
            name: "creditCard",
            label: "Payment Card",
            promoted: true,
            fields: [
              {
                name: "cardholderName",
                label: "Cardholder Name",
                errorLabel: "Cardholder name",
              },
              {
                name: "accountNo",
                label: "Account Number",
                errorLabel: "Credit card number",
              },
              {
                name: "expDate",
                label: "Expiration Date",
                errorLabel: "Expiration date",
              },
              {
                name: "cvv",
                label: "Security Code",
                errorLabel: "Security code",
              },
            ],
          },
        ],
        avsRules: {
          rejectAddressMismatch: false,
          rejectPostCodeMismatch: false,
          rejectUnknown: false,
        },
      },
    };

    const resp = await axios.post(`${VP_API_BASE}/sessions`, payload, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    const sessionId = resp.data?.id as string;
    const scriptSrc = `${VP_BASE}/client.js`;
    return new Response(JSON.stringify({ sessionId, scriptSrc }), {
      status: 200,
    });
  } catch (err: any) {
    console.error("VersaPay session error:", err.response?.data || err.message);
    return new Response(JSON.stringify({ error: "Session creation failed" }), {
      status: 500,
    });
  }
}
