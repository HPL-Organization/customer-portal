import { NextRequest } from "next/server";
import { compareProducts } from "@/lib/product_sync/compare";

const ADMIN_SYNC_SECRET = process.env.ADMIN_SYNC_SECRET!;
const ADMIN_SECRET_HEADER = "x-admin-secret";

export async function POST(req: NextRequest) {
  if (
    !ADMIN_SYNC_SECRET ||
    req.headers.get(ADMIN_SECRET_HEADER) !== ADMIN_SYNC_SECRET
  ) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const dryRun = req.nextUrl.searchParams.get("dry") === "1";

  try {
    const summary = await compareProducts({ dryRun });
    return new Response(JSON.stringify({ ok: true, summary }), {
      status: 200,
    });
  } catch (err: any) {
    console.error("Compare products failed:", err);
    return new Response(
      JSON.stringify({ error: "Compare products failed" }),
      { status: 500 }
    );
  }
}
