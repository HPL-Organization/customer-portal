import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getValidToken } from "@/lib/netsuite/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_SYNC_SECRET = (process.env.ADMIN_SYNC_SECRET || "").trim();
const ADMIN_SECRET_HEADER = "x-admin-secret";

const NETSUITE_ENV = (process.env.NETSUITE_ENV || "prod").toLowerCase();
const NETSUITE_ACCOUNT_ID =
  NETSUITE_ENV === "sb"
    ? process.env.NETSUITE_ACCOUNT_ID_SB!
    : process.env.NETSUITE_ACCOUNT_ID!;

const NETSUITE_RESTLET_URL =
  process.env.NETSUITE_EMAIL_IN_PORTAL_RESTLET_URL ||
  `https://${NETSUITE_ACCOUNT_ID}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=3456&deploy=1`;
const SUPABASE_UPDATE_CHUNK_SIZE = 500;

function normalizeEmail(email: unknown) {
  return String(email || "").trim().toLowerCase();
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function getServiceSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function getAuthUserEmailSet(supabase: ReturnType<typeof getServiceSupabase>) {
  const perPage = 1000;
  let page = 1;
  const emails = new Set<string>();

  for (;;) {
    console.log("[sync-email-in-portal] listing auth users page", page);
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(error.message || "Failed to list auth users");
    }

    const users = data?.users ?? [];
    console.log(
      "[sync-email-in-portal] auth users page result",
      JSON.stringify({ page, users: users.length }),
    );
    if (users.length === 0) break;

    for (const user of users) {
      const email = normalizeEmail(user.email);
      if (email) emails.add(email);
    }

    if (users.length < perPage) break;
    page += 1;
  }

  return emails;
}

async function getUnsyncedCustomerInformationEmails(
  supabase: ReturnType<typeof getServiceSupabase>,
  authEmails: Set<string>,
) {
  const pageSize = 1000;
  let from = 0;
  const normalizedToStored = new Map<string, string[]>();

  for (;;) {
    console.log(
      "[sync-email-in-portal] loading customer_information range",
      JSON.stringify({ from, to: from + pageSize - 1 }),
    );
    const { data, error } = await supabase
      .from("customer_information")
      .select("email")
      .eq("email_in_portal_checked", false)
      .not("email", "is", null)
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(error.message || "Failed to load customer_information");
    }

    const rows = Array.isArray(data) ? data : [];
    console.log(
      "[sync-email-in-portal] customer_information range result",
      JSON.stringify({ from, rows: rows.length }),
    );
    if (rows.length === 0) break;

    for (const row of rows as Array<{ email: string | null }>) {
      const storedEmail = String(row.email || "").trim();
      const email = normalizeEmail(storedEmail);
      if (!email || !authEmails.has(email)) continue;
      const existing = normalizedToStored.get(email) ?? [];
      existing.push(storedEmail);
      normalizedToStored.set(email, existing);
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return normalizedToStored;
}

async function sendEmailsToRestlet(emails: string[]) {
  const token = await getValidToken();
  const res = await fetch(NETSUITE_RESTLET_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      emails,
      value: true,
    }),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      body?.message || body?.error || `NetSuite RESTlet failed with ${res.status}`,
    );
  }

  return body as {
    ok?: boolean;
    updated?: number;
    success?: Array<{ email?: string; customerId?: number }>;
    failed?: Array<{ email?: string; message?: string }>;
    stoppedEarly?: boolean;
    remainingUsage?: number;
  };
}

async function updateCustomerInformationInChunks(
  supabase: ReturnType<typeof getServiceSupabase>,
  storedSuccessEmails: string[],
) {
  let updated = 0;
  const updateChunks = chunk(storedSuccessEmails, SUPABASE_UPDATE_CHUNK_SIZE);

  console.log(
    "[sync-email-in-portal] updating customer_information",
    JSON.stringify({
      storedSuccessEmails: storedSuccessEmails.length,
      updateChunkSize: SUPABASE_UPDATE_CHUNK_SIZE,
      updateChunkCount: updateChunks.length,
    }),
  );

  for (const [index, emails] of updateChunks.entries()) {
    console.log(
      "[sync-email-in-portal] updating customer_information chunk",
      JSON.stringify({
        chunk: index + 1,
        chunkCount: updateChunks.length,
        chunkSize: emails.length,
      }),
    );

    const { data, error } = await supabase
      .from("customer_information")
      .update({ email_in_portal_checked: true })
      .in("email", emails)
      .eq("email_in_portal_checked", false)
      .select("info_id");

    if (error) {
      console.error(
        "[sync-email-in-portal] customer_information chunk update failed",
        JSON.stringify({
          chunk: index + 1,
          chunkCount: updateChunks.length,
          chunkSize: emails.length,
          message: error.message,
        }),
      );
      throw new Error(error.message || "Failed to update customer_information");
    }

    const chunkUpdated = Array.isArray(data) ? data.length : 0;
    updated += chunkUpdated;

    console.log(
      "[sync-email-in-portal] customer_information chunk updated",
      JSON.stringify({
        chunk: index + 1,
        chunkCount: updateChunks.length,
        chunkUpdated,
        updatedSoFar: updated,
      }),
    );
  }

  return updated;
}

export async function POST(req: NextRequest) {
  if (!ADMIN_SYNC_SECRET) {
    return NextResponse.json(
      { ok: false, error: "Missing ADMIN_SYNC_SECRET" },
      { status: 500 },
    );
  }

  const headerSecret = (req.headers.get(ADMIN_SECRET_HEADER) || "").trim();
  if (headerSecret !== ADMIN_SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const debugParam = req.nextUrl.searchParams.get("debug");
  const debug = debugParam === "1";
  const updateOnly = debugParam === "2";
  const batchSize = Math.max(
    1,
    Math.min(100, Number(req.nextUrl.searchParams.get("batchSize") || "25")),
  );
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit =
    limitRaw == null ? null : Math.max(1, Number(limitRaw) || 0);

  try {
    console.log("[sync-email-in-portal] start", {
      dry,
      debug,
      updateOnly,
      batchSize,
      limit,
    });

    const supabase = getServiceSupabase();

    const authEmails = await getAuthUserEmailSet(supabase);
    console.log(
      "[sync-email-in-portal] auth email collection complete",
      JSON.stringify({ authUserEmails: authEmails.size }),
    );

    const normalizedToStored = await getUnsyncedCustomerInformationEmails(
      supabase,
      authEmails,
    );
    const matchedEmails = Array.from(normalizedToStored.keys());
    console.log(
      "[sync-email-in-portal] matched customer_information emails",
      JSON.stringify({ matchedCustomerInformationEmails: matchedEmails.length }),
    );

    const targetEmails =
      limit && Number.isFinite(limit) ? matchedEmails.slice(0, limit) : matchedEmails;
    console.log(
      "[sync-email-in-portal] target emails prepared",
      JSON.stringify({ targetEmails: targetEmails.length, batchSize }),
    );

    if (dry) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        authUserEmails: authEmails.size,
        matchedCustomerInformationEmails: matchedEmails.length,
        targetEmails: targetEmails.length,
        preview: targetEmails.slice(0, 50),
        batchSize,
      });
    }

    if (debug) {
      const batches = chunk(targetEmails, batchSize);
      const payload = {
        ok: true,
        debug: true,
        authUserEmails: authEmails.size,
        matchedCustomerInformationEmails: matchedEmails.length,
        targetEmails: targetEmails.length,
        batchSize,
        batchCount: batches.length,
        batchSizes: batches.map((batch) => batch.length),
        preview: targetEmails.slice(0, 50),
      };

      console.log("[sync-email-in-portal:debug]", payload);

      return NextResponse.json(payload);
    }

    if (updateOnly) {
      const updated = await updateCustomerInformationInChunks(
        supabase,
        targetEmails,
      );

      console.log(
        "[sync-email-in-portal] update-only complete",
        JSON.stringify({
          candidateEmails: targetEmails.length,
          updated,
        }),
      );

      return NextResponse.json({
        ok: true,
        debug: "2",
        updateOnly: true,
        candidateEmails: targetEmails.length,
        updated,
        updateChunkSize: SUPABASE_UPDATE_CHUNK_SIZE,
      });
    }

    let requested = 0;
    let updated = 0;
    let stoppedEarly = false;
    const successEmails = new Set<string>();
    const failed: Array<{ email: string; message: string }> = [];
    const chunks = chunk(targetEmails, batchSize);
    console.log(
      "[sync-email-in-portal] beginning restlet sync",
      JSON.stringify({ batchCount: chunks.length }),
    );

    for (const [index, emails] of chunks.entries()) {
      console.log(
        "[sync-email-in-portal] sending restlet batch",
        JSON.stringify({
          batch: index + 1,
          batchCount: chunks.length,
          batchSize: emails.length,
        }),
      );
      const body = await sendEmailsToRestlet(emails);
      requested += emails.length;

      for (const row of body.success || []) {
        const email = normalizeEmail(row.email);
        if (email) successEmails.add(email);
      }

      for (const row of body.failed || []) {
        const email = normalizeEmail(row.email);
        if (!email) continue;
        failed.push({
          email,
          message: String(row.message || "NetSuite update failed"),
        });
      }

      console.log(
        "[sync-email-in-portal] restlet batch complete",
        JSON.stringify({
          batch: index + 1,
          batchCount: chunks.length,
          requestedSoFar: requested,
          batchSucceeded: (body.success || []).length,
          batchFailed: (body.failed || []).length,
          stoppedEarly: Boolean(body.stoppedEarly),
          remainingUsage: body.remainingUsage ?? null,
        }),
      );

      if (body.stoppedEarly) {
        stoppedEarly = true;
        break;
      }
    }

    const successList = Array.from(successEmails);
    const storedSuccessEmails = Array.from(
      new Set(
        successList.flatMap((email) => normalizedToStored.get(email) ?? []),
      ),
    );

    if (storedSuccessEmails.length > 0) {
      updated = await updateCustomerInformationInChunks(
        supabase,
        storedSuccessEmails,
      );
    }

    console.log(
      "[sync-email-in-portal] complete",
      JSON.stringify({
        requested,
        candidateEmails: targetEmails.length,
        updated,
        failed: failed.length,
        stoppedEarly,
      }),
    );

    return NextResponse.json({
      ok: failed.length === 0 && !stoppedEarly,
      requested,
      candidateEmails: targetEmails.length,
      updated,
      succeeded: successList,
      failed,
      stoppedEarly,
      batchSize,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
