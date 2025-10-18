import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { getValidToken } from "@/lib/netsuite/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NS_ENV = (process.env.NETSUITE_ENV || "prod").toLowerCase();
const NETSUITE_ACCOUNT_ID =
  NS_ENV === "sb"
    ? process.env.NETSUITE_ACCOUNT_ID_SB!
    : process.env.NETSUITE_ACCOUNT_ID!;
const SUITEQL_BASE = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_SYNC_SECRET = (process.env.ADMIN_SYNC_SECRET || "").trim();

const BATCH_WRITE = 500;

type Row = { id: number; email?: string | null; altemail?: string | null };

function normalizeEmail(e: string) {
  return e.trim().toLowerCase();
}

async function runSuiteQLAll(query: string, token: string) {
  let all: any[] = [];
  let url = SUITEQL_BASE;
  let payload = { q: query };
  for (;;) {
    const resp = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "transient",
      },
      timeout: 60000,
      validateStatus: () => true,
    });
    if (resp.status !== 200)
      return { error: { status: resp.status, body: resp.data }, items: all };
    const items = Array.isArray(resp.data?.items) ? resp.data.items : [];
    all.push(...items);
    const nextLink = resp.data?.links?.find((l: any) => l?.rel === "next");
    if (!nextLink?.href) break;
    url = nextLink.href;
    payload = { q: query };
  }
  return { items: all };
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const limit = Math.max(
    1,
    Math.min(100, Number(url.searchParams.get("limit") || "5"))
  );
  const sampleInsert = Math.max(
    0,
    Number(url.searchParams.get("sampleInsert") || "0")
  );

  if (!ADMIN_SYNC_SECRET) {
    return NextResponse.json(
      { error: "Missing ADMIN_SYNC_SECRET" },
      { status: 500 }
    );
  }
  const headerSecret = (req.headers.get("x-admin-secret") || "").trim();
  const paramSecret = (url.searchParams.get("secret") || "").trim();
  if (headerSecret !== ADMIN_SYNC_SECRET && paramSecret !== ADMIN_SYNC_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const token = await getValidToken();

    let totalCustomers = 0;
    let customersWithEmail = 0;
    let customersWithAltEmail = 0;

    if (dry) {
      const probeTotal = await runSuiteQLAll(
        `select count(*) as c from customer`,
        token
      );
      const probeWithEmail = await runSuiteQLAll(
        `select count(*) as c from customer where email is not null and length(trim(email)) > 0`,
        token
      );
      const probeAltEmail = await runSuiteQLAll(
        `select count(*) as c from customer where altemail is not null and length(trim(altemail)) > 0`,
        token
      );
      totalCustomers = Number((probeTotal as any).items?.[0]?.c || 0);
      customersWithEmail = Number((probeWithEmail as any).items?.[0]?.c || 0);
      customersWithAltEmail = Number((probeAltEmail as any).items?.[0]?.c || 0);
    }

    const qCustEmail = `
      select id, email
      from customer
      where isinactive = 'F'
        and email is not null
        and length(trim(email)) > 0
      order by id
    `;
    const r1 = await runSuiteQLAll(qCustEmail, token);
    if ((r1 as any).error) {
      return NextResponse.json(
        {
          error: "netsuite_suiteql_error",
          upstream_status: (r1 as any).error.status,
          upstream_body: (r1 as any).error.body,
        },
        { status: 502 }
      );
    }

    const collected: Array<{ email: string; netsuite_customer_id: number }> =
      [];
    for (const row of (r1 as any).items as Row[]) {
      const raw = (row.email || "").trim();
      if (!raw) continue;
      const idNum = Number(row.id);
      if (!Number.isFinite(idNum)) continue;
      collected.push({
        email: normalizeEmail(raw),
        netsuite_customer_id: idNum,
      });
    }

    const haveEmailSet = new Set(collected.map((x) => x.netsuite_customer_id));
    const qAltEmail = `
      select id, altemail
      from customer
      where isinactive = 'F'
        and altemail is not null
        and length(trim(altemail)) > 0
      order by id
    `;
    const r2 = await runSuiteQLAll(qAltEmail, token);
    if ((r2 as any).error) {
      return NextResponse.json(
        {
          error: "netsuite_suiteql_error_altemail",
          upstream_status: (r2 as any).error.status,
          upstream_body: (r2 as any).error.body,
        },
        { status: 502 }
      );
    }
    for (const row of (r2 as any).items as Row[]) {
      const idNum = Number(row.id);
      if (!Number.isFinite(idNum)) continue;
      if (haveEmailSet.has(idNum)) continue;
      const raw = (row.altemail || "").trim();
      if (!raw) continue;
      collected.push({
        email: normalizeEmail(raw),
        netsuite_customer_id: idNum,
      });
      haveEmailSet.add(idNum);
    }

    const qContact = `
      with primary_contact as (
        select company as customer_id, min(id) as contact_id
        from contact
        where email is not null and length(trim(email)) > 0
        group by company
      )
      select p.customer_id as id, c.email
      from primary_contact p
      join contact c on c.id = p.contact_id
      where p.customer_id is not null
      order by p.customer_id
    `;
    const r3 = await runSuiteQLAll(qContact, token);
    if ((r3 as any).error) {
      return NextResponse.json(
        {
          error: "netsuite_suiteql_error_contact",
          upstream_status: (r3 as any).error.status,
          upstream_body: (r3 as any).error.body,
        },
        { status: 502 }
      );
    }
    for (const row of (r3 as any).items as Row[]) {
      const idNum = Number(row.id);
      if (!Number.isFinite(idNum)) continue;
      if (haveEmailSet.has(idNum)) continue;
      const raw = (row.email || "").trim();
      if (!raw) continue;
      collected.push({
        email: normalizeEmail(raw),
        netsuite_customer_id: idNum,
      });
      haveEmailSet.add(idNum);
    }

    const dedup = new Map<string, number>();
    for (const r of collected)
      if (!dedup.has(r.email)) dedup.set(r.email, r.netsuite_customer_id);
    const uniqueRows = Array.from(dedup.entries()).map(
      ([email, netsuite_customer_id]) => ({ email, netsuite_customer_id })
    );

    const previewCandidates = uniqueRows.slice(0, limit);
    const previewSelect = await supabase
      .from("profiles")
      .select("email")
      .in(
        "email",
        previewCandidates.map((r) => r.email)
      );
    if (previewSelect.error) {
      return NextResponse.json(
        {
          error: "supabase_preview_select_error",
          message: previewSelect.error.message,
        },
        { status: 502 }
      );
    }

    const existingPreviewSet = new Set(
      (previewSelect.data || []).map((r: any) => r.email as string)
    );
    const preview_existing = previewCandidates.filter((r) =>
      existingPreviewSet.has(r.email)
    );
    const preview_new = previewCandidates.filter(
      (r) => !existingPreviewSet.has(r.email)
    );

    if (dry) {
      return NextResponse.json({
        mode: "dry-run",
        probes: { totalCustomers, customersWithEmail, customersWithAltEmail },
        netsuite_records_scanned: collected.length,
        unique_emails_seen: uniqueRows.length,
        preview_limit: limit,
        preview_candidates: previewCandidates,
        preview_existing_in_profiles: preview_existing,
        preview_new_to_insert: preview_new,
      });
    }

    if (sampleInsert > 0) {
      const toInsertNow = uniqueRows.slice(0, sampleInsert);
      if (toInsertNow.length > 0) {
        const ins = await supabase.from("profiles").upsert(
          toInsertNow.map((r) => ({
            user_id: null as unknown as string | null,
            email: r.email,
            netsuite_customer_id: r.netsuite_customer_id,
          })),
          { onConflict: "email", ignoreDuplicates: true }
        );
        if (ins.error) {
          return NextResponse.json(
            { error: "supabase_upsert_error", message: ins.error.message },
            { status: 502 }
          );
        }
      }
      const after = await supabase
        .from("profiles")
        .select("email, netsuite_customer_id, user_id")
        .in(
          "email",
          toInsertNow.map((r) => r.email)
        );
      if (after.error) {
        return NextResponse.json(
          {
            error: "supabase_after_select_error",
            message: after.error.message,
          },
          { status: 502 }
        );
      }
      return NextResponse.json({
        mode: "sample-insert",
        netsuite_records_scanned: collected.length,
        unique_emails_seen: uniqueRows.length,
        attempted_sample_insert: sampleInsert,
        inserted_count: toInsertNow.length,
        inserted_preview_after: after.data || [],
      });
    }

    let inserted = 0;
    for (let i = 0; i < uniqueRows.length; i += BATCH_WRITE) {
      const chunk = uniqueRows.slice(i, i + BATCH_WRITE);
      const sel = await supabase
        .from("profiles")
        .select("email")
        .in(
          "email",
          chunk.map((r) => r.email)
        );
      if (sel.error) {
        return NextResponse.json(
          {
            error: "supabase_batch_select_error",
            batch_index: i,
            message: sel.error.message,
          },
          { status: 502 }
        );
      }
      const existingSet = new Set(
        (sel.data || []).map((r: any) => r.email as string)
      );
      const toInsert = chunk.filter((r) => !existingSet.has(r.email));
      if (toInsert.length === 0) continue;
      const ins = await supabase.from("profiles").upsert(
        toInsert.map((r) => ({
          user_id: null as unknown as string | null,
          email: r.email,
          netsuite_customer_id: r.netsuite_customer_id,
        })),
        { onConflict: "email", ignoreDuplicates: true }
      );
      if (ins.error) {
        return NextResponse.json(
          {
            error: "supabase_batch_upsert_error",
            batch_index: i,
            message: ins.error.message,
          },
          { status: 502 }
        );
      }
      inserted += toInsert.length;
    }

    return NextResponse.json({
      mode: "full-backfill",
      netsuite_records_scanned: collected.length,
      unique_emails_seen: uniqueRows.length,
      new_profiles_inserted: inserted,
      already_present: uniqueRows.length - inserted,
      preview_limit: limit,
      preview_candidates: previewCandidates,
      preview_existing_in_profiles: preview_existing,
      preview_new_to_insert: preview_new,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "unhandled", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
