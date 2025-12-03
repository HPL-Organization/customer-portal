import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
  }
);

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type");

  if (!type) {
    return NextResponse.json(
      {
        success: false,
        message: "Query parameter 'type' is required",
      },
      { status: 400 }
    );
  }

  const { error, count } = await supabase
    .from("live_events")
    .delete({ count: "exact" })
    .eq("type", type);

  if (error) {
    return NextResponse.json(
      {
        success: false,
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      success: true,
      deletedCount: count ?? 0,
    },
    { status: 200 }
  );
}
