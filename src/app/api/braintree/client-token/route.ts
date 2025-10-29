export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { gateway } from "@/lib/braintree/braintree";

export async function POST(req: NextRequest) {
  try {
    const { nsCustomerId } = await req.json();
    const idStr = nsCustomerId ? String(nsCustomerId) : null;

    if (!idStr) {
      const token = await gateway.clientToken.generate({});
      return NextResponse.json({ clientToken: token.clientToken });
    }

    try {
      await gateway.customer.find(idStr);
    } catch {
      const created = await gateway.customer.create({ id: idStr });
      if (!created.success)
        return NextResponse.json({ error: created.message }, { status: 422 });
    }

    const token = await gateway.clientToken.generate({ customerId: idStr });
    return NextResponse.json({ clientToken: token.clientToken });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "token error" },
      { status: 500 }
    );
  }
}
