import { NextResponse } from "next/server";
import { savePaymentMethod } from "../../../../lib/netsuite/savePaymentMethod";

type SavePMBody = {
  customerInternalId?: number | string;
  token?: string;
  accountNumberLastFour?: string;
  accountType?: string;
  cardNameOnCard?: string;
  tokenExpirationDate?: string;
};

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as SavePMBody;

    const customerInternalIdNum = Number(body.customerInternalId);
    if (!Number.isFinite(customerInternalIdNum) || customerInternalIdNum <= 0) {
      return NextResponse.json(
        { error: "Invalid or missing customerInternalId" },
        { status: 400 }
      );
    }
    if (!body.token || typeof body.token !== "string") {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const data = await savePaymentMethod(customerInternalIdNum, body.token, {
      accountNumberLastFour: body.accountNumberLastFour,
      accountType: body.accountType,
      cardNameOnCard: body.cardNameOnCard,
      tokenExpirationDate: body.tokenExpirationDate,
    });

    return NextResponse.json(data, { status: 200 });
  } catch (err: unknown) {
    const error = err as {
      message?: string;
      status?: number;
      ns?: unknown;
      body?: unknown;
      stack?: string;
    };

    console.error("Error saving payment method", {
      message: error?.message ?? "",
      status: error?.status ?? "",
      ns: error?.ns ?? "",
      body: error?.body ?? "",
      stack: error?.stack ?? "",
    });

    return NextResponse.json(
      { error: "Failed to save payment method" },
      { status: 500 }
    );
  }
}
