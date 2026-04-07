import { NextRequest, NextResponse } from "next/server";
import { processAutoPayGroups } from "@/lib/autopay/process-groups";
import { getAutoPaySupabase, resolveScopedSoIds, toFiniteNumber, truthyParam } from "@/lib/autopay/utils";

const ADMIN_SYNC_SECRET = process.env.ADMIN_SYNC_SECRET!;
const ADMIN_SECRET_HEADER = "x-admin-secret";

type RouteOptions = {
  debug: boolean;
  dryRun: boolean;
  customerId: number | null;
  soId: number | null;
  queueIds: number[];
  maxGroups: number;
  runGrouping: boolean;
  runNotifications: boolean;
  runCharges: boolean;
};

function parseIds(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((num) => Number.isFinite(num) && num > 0);
}

async function parseOptions(req: NextRequest): Promise<RouteOptions> {
  const body =
    req.method === "POST"
      ? ((await req.json().catch(() => ({}))) as Record<string, unknown>)
      : {};
  const get = (key: string) =>
    req.nextUrl.searchParams.get(key) ??
    (body?.[key] != null ? String(body[key]) : null);

  const debug = truthyParam(get("debug"));
  const dryRun = truthyParam(get("dry")) || truthyParam(get("dryRun"));
  const customerId = toFiniteNumber(get("customerId"));
  const soId = toFiniteNumber(get("soId"));
  const queueIds = [
    ...new Set([
      ...parseIds(get("queueIds")),
      ...parseIds(get("queueId")),
    ]),
  ];
  const maxGroups = Math.max(
    1,
    Math.min(200, Number(get("maxGroups") || 25)),
  );

  return {
    debug,
    dryRun,
    customerId,
    soId,
    queueIds,
    maxGroups,
    runGrouping: !truthyParam(get("skipGrouping")),
    runNotifications: !truthyParam(get("skipNotifications")),
    runCharges: !truthyParam(get("skipCharges")),
  };
}

async function handle(req: NextRequest) {
  if (
    !ADMIN_SYNC_SECRET ||
    req.headers.get(ADMIN_SECRET_HEADER) !== ADMIN_SYNC_SECRET
  ) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const options = await parseOptions(req);
  if (options.debug && !options.customerId && !options.soId && !options.queueIds.length) {
    return NextResponse.json(
      {
        ok: false,
        error: "Debug mode requires customerId, soId, or queueIds",
      },
      { status: 400 },
    );
  }

  const supabase = getAutoPaySupabase();
  const scopedSoIds = await resolveScopedSoIds(supabase, {
    customerId: options.customerId,
    soId: options.soId,
  });

  const result = await processAutoPayGroups({
    supabase,
    dryRun: options.dryRun,
    debug: options.debug,
    customerId: options.customerId,
    soId: options.soId,
    queueIds: options.queueIds,
    scopedSoIds,
    maxGroups: options.maxGroups,
    runGrouping: options.runGrouping,
    runNotifications: options.runNotifications,
    runCharges: options.runCharges,
  });

  return NextResponse.json({
    ok: true,
    debug: options.debug,
    dryRun: options.dryRun,
    filters: {
      customerId: options.customerId,
      soId: options.soId,
      queueIds: options.queueIds,
      scopedSoIds,
      maxGroups: options.maxGroups,
    },
    result,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
