// src/app/api/supabase/resolve-customer-info-duplicates/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import fs from "fs";
import readline from "readline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_SYNC_SECRET = (process.env.ADMIN_SYNC_SECRET || "").trim();

const PAGE_SIZE = 1000;

type CILean = {
  info_id: string;
  customer_id: number;
  email: string | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
};

type CustomerInfoRow = {
  info_id: string;
  customer_id: number;
  email: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  phone: string | null;
  mobile: string | null;

  shipping_address1: string | null;
  shipping_address2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_zip: string | null;
  shipping_country: string | null;

  billing_address1: string | null;
  billing_address2: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_zip: string | null;
  billing_country: string | null;

  shipping_verified: boolean;
  billing_verified: boolean;

  terms_compliance: boolean;
  terms_agreed_at: string | null;

  user_id: string | null;
  hubspot_id: number | null;

  check_invoice: boolean;
  check_invoice_range: any | null;
  check_invoice_result: boolean | null;

  created_at: string;
  updated_at: string;
};

function normalizeEmail(e: string) {
  return e.trim().toLowerCase();
}

function normEmailOrNull(e: any): string | null {
  if (typeof e !== "string") return null;
  const s = e.trim();
  if (!s) return null;
  return normalizeEmail(s);
}

function isEmptyText(v: any) {
  return (
    v === null || v === undefined || (typeof v === "string" && v.trim() === "")
  );
}

async function loadEmailToCustomerIdNonColliding(fileAbsPath: string) {
  const emailToId = new Map<string, number>();
  const collisions = new Set<string>();

  let lines = 0;
  let parsed = 0;
  let withEmail = 0;
  let collisionCount = 0;

  if (!fs.existsSync(fileAbsPath)) {
    const err: any = new Error(`JSONL file not found: ${fileAbsPath}`);
    err.status = 500;
    throw err;
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(fileAbsPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lines += 1;
    const s = (line || "").trim();
    if (!s) continue;

    let obj: any = null;
    try {
      obj = JSON.parse(s);
    } catch {
      continue;
    }
    parsed += 1;

    const rawEmail = obj?.email;
    const rawId = obj?.customer_id;

    const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
    if (!email) continue;

    const idNum = Number(rawId);
    if (!Number.isFinite(idNum)) continue;

    const emailNorm = normalizeEmail(email);
    if (!emailNorm) continue;

    withEmail += 1;

    const prev = emailToId.get(emailNorm);
    if (prev !== undefined && prev !== idNum) {
      if (!collisions.has(emailNorm)) {
        collisions.add(emailNorm);
        collisionCount += 1;
      }
      emailToId.delete(emailNorm);
      continue;
    }

    if (!collisions.has(emailNorm)) emailToId.set(emailNorm, idNum);
  }

  return {
    emailToId,
    collisions,
    stats: {
      lines,
      parsed,
      withEmail,
      collisionEmails: collisions.size,
      collisionCount,
      distinctNonCollidingEmails: emailToId.size,
    },
  };
}

function buildCanonicalUpdate(
  canonical: CustomerInfoRow,
  losers: CustomerInfoRow[]
) {
  const copiedFields: string[] = [];
  const update: Partial<CustomerInfoRow> = {};

  const TEXT_FIELDS: Array<keyof CustomerInfoRow> = [
    "email",
    "first_name",
    "middle_name",
    "last_name",
    "phone",
    "mobile",
    "shipping_address1",
    "shipping_address2",
    "shipping_city",
    "shipping_state",
    "shipping_zip",
    "shipping_country",
    "billing_address1",
    "billing_address2",
    "billing_city",
    "billing_state",
    "billing_zip",
    "billing_country",
  ];

  const TS_FIELDS: Array<keyof CustomerInfoRow> = ["terms_agreed_at"];
  const JSON_FIELDS: Array<keyof CustomerInfoRow> = ["check_invoice_range"];
  const NULLABLE_BOOL_FIELDS: Array<keyof CustomerInfoRow> = [
    "check_invoice_result",
  ];

  for (const loser of losers) {
    for (const f of TEXT_FIELDS) {
      const cur = (canonical as any)[f];
      const src = (loser as any)[f];
      if (isEmptyText(cur) && !isEmptyText(src)) {
        (update as any)[f] = src;
        copiedFields.push(String(f));
      }
    }

    for (const f of TS_FIELDS) {
      const cur = (canonical as any)[f];
      const src = (loser as any)[f];
      if ((cur === null || cur === undefined) && src) {
        (update as any)[f] = src;
        copiedFields.push(String(f));
      }
    }

    for (const f of JSON_FIELDS) {
      const cur = (canonical as any)[f];
      const src = (loser as any)[f];
      if (
        (cur === null || cur === undefined) &&
        src !== null &&
        src !== undefined
      ) {
        (update as any)[f] = src;
        copiedFields.push(String(f));
      }
    }

    for (const f of NULLABLE_BOOL_FIELDS) {
      const cur = (canonical as any)[f];
      const src = (loser as any)[f];
      if (
        (cur === null || cur === undefined) &&
        (src === true || src === false)
      ) {
        (update as any)[f] = src;
        copiedFields.push(String(f));
      }
    }

    if (!canonical.shipping_verified && loser.shipping_verified) {
      update.shipping_verified = true;
      copiedFields.push("shipping_verified");
    }
    if (!canonical.billing_verified && loser.billing_verified) {
      update.billing_verified = true;
      copiedFields.push("billing_verified");
    }
    if (!canonical.terms_compliance && loser.terms_compliance) {
      update.terms_compliance = true;
      copiedFields.push("terms_compliance");
    }
    if (!canonical.check_invoice && loser.check_invoice) {
      update.check_invoice = true;
      copiedFields.push("check_invoice");
    }

    if (
      (canonical.hubspot_id === null || canonical.hubspot_id === undefined) &&
      loser.hubspot_id
    ) {
      update.hubspot_id = loser.hubspot_id;
      copiedFields.push("hubspot_id");
    }
  }

  const uniq = Array.from(new Set(copiedFields));
  return { update, copiedFields: uniq };
}

type UnsafeReason =
  | "jsonl_collision"
  | "missing_jsonl_mapping"
  | "missing_canonical_row_in_supabase_group";

export async function POST(req: NextRequest) {
  const url = new URL(req.url);

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

  const limit = Math.max(
    1,
    Math.min(500, Number(url.searchParams.get("limit") || "5"))
  );
  const dry = url.searchParams.get("dry") === "1";

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const jsonlPath = path.join(process.cwd(), "exports", "customers2.jsonl");
    const {
      emailToId: nsByEmail,
      collisions,
      stats: jsonlStats,
    } = await loadEmailToCustomerIdNonColliding(jsonlPath);

    const byEmail = new Map<string, CILean[]>();
    const collisionRows: CILean[] = [];
    let offset = 0;
    let pages = 0;
    let rows_scanned = 0;

    for (;;) {
      const { data, error } = await supabase
        .from("customer_information")
        .select("info_id, customer_id, email, user_id, created_at, updated_at")
        .not("email", "is", null)
        .order("created_at", { ascending: true })
        .order("info_id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        return NextResponse.json(
          { error: "supabase_select_error", message: error.message },
          { status: 502 }
        );
      }

      const rows = (data || []) as CILean[];
      if (rows.length === 0) break;

      pages += 1;
      rows_scanned += rows.length;

      for (const r of rows) {
        const raw = (r.email || "").trim();
        if (!raw) continue;
        const email_norm = normalizeEmail(raw);
        if (!email_norm) continue;

        if (collisions.has(email_norm)) collisionRows.push(r);

        const arr = byEmail.get(email_norm) || [];
        arr.push(r);
        byEmail.set(email_norm, arr);
      }

      offset += rows.length;
      if (rows.length < PAGE_SIZE) break;
    }

    const duplicateGroups = Array.from(byEmail.entries())
      .filter(([, rows]) => rows.length > 1)
      .map(([email_norm, rows]) => ({ email_norm, rows }))
      .sort(
        (a, b) =>
          b.rows.length - a.rows.length ||
          a.email_norm.localeCompare(b.email_norm)
      );

    const safeGroups: Array<{
      email_norm: string;
      canonical_customer_id: number;
      canonical_info_id: string;
      rows: CILean[];
    }> = [];

    for (const g of duplicateGroups) {
      if (collisions.has(g.email_norm)) continue;
      const canonicalId = nsByEmail.get(g.email_norm);
      if (!canonicalId) continue;

      const canonicalRow = g.rows.find(
        (r) => Number(r.customer_id) === canonicalId
      );
      if (!canonicalRow) continue;

      safeGroups.push({
        email_norm: g.email_norm,
        canonical_customer_id: canonicalId,
        canonical_info_id: canonicalRow.info_id,
        rows: g.rows,
      });
    }

    const safeEmailSet = new Set(safeGroups.map((x) => x.email_norm));
    const unsafeGroups = duplicateGroups
      .filter((g) => !safeEmailSet.has(g.email_norm))
      .map((g) => {
        let reason: UnsafeReason = "missing_jsonl_mapping";
        const canonicalId = nsByEmail.get(g.email_norm);

        if (collisions.has(g.email_norm)) {
          reason = "jsonl_collision";
        } else if (!canonicalId) {
          reason = "missing_jsonl_mapping";
        } else {
          const canonicalRow = g.rows.find(
            (r) => Number(r.customer_id) === canonicalId
          );
          if (!canonicalRow) reason = "missing_canonical_row_in_supabase_group";
        }

        return {
          email_norm: g.email_norm,
          reason,
          group_size: g.rows.length,
          jsonl_canonical_customer_id: canonicalId ?? null,
          rows: g.rows.map((r) => ({
            info_id: r.info_id,
            customer_id: Number(r.customer_id),
            user_id: r.user_id,
            created_at: r.created_at,
          })),
        };
      });

    const unsafe_summary = unsafeGroups.reduce(
      (acc, g) => {
        acc.total += 1;
        acc.by_reason[g.reason] = (acc.by_reason[g.reason] || 0) + 1;
        return acc;
      },
      {
        total: 0,
        by_reason: {} as Record<string, number>,
      }
    );

    const toProcess = safeGroups.slice(0, limit);
    const results: any[] = [];

    for (const g of toProcess) {
      const { data: fullRows, error: fetchErr } = await supabase
        .from("customer_information")
        .select(
          [
            "info_id",
            "customer_id",
            "email",
            "first_name",
            "middle_name",
            "last_name",
            "phone",
            "mobile",
            "shipping_address1",
            "shipping_address2",
            "shipping_city",
            "shipping_state",
            "shipping_zip",
            "shipping_country",
            "billing_address1",
            "billing_address2",
            "billing_city",
            "billing_state",
            "billing_zip",
            "billing_country",
            "shipping_verified",
            "billing_verified",
            "terms_compliance",
            "terms_agreed_at",
            "user_id",
            "hubspot_id",
            "check_invoice",
            "check_invoice_range",
            "check_invoice_result",
            "created_at",
            "updated_at",
          ].join(",")
        )
        .ilike("email", g.email_norm);

      if (fetchErr) {
        results.push({
          email_norm: g.email_norm,
          status: "error_fetch_group",
          message: fetchErr.message,
        });
        continue;
      }

      const groupRows = (fullRows || []) as CustomerInfoRow[];

      const canonical = groupRows.find(
        (r) => Number(r.customer_id) === g.canonical_customer_id
      );

      if (!canonical) {
        results.push({
          email_norm: g.email_norm,
          status: "skipped_no_canonical_row",
          canonical_customer_id: g.canonical_customer_id,
        });
        continue;
      }

      const losers = groupRows.filter((r) => r.info_id !== canonical.info_id);

      const loserUserIds = Array.from(
        new Set(losers.map((r) => r.user_id).filter((x) => !!x))
      ) as string[];

      const canonicalHasUser = !!canonical.user_id;

      const canMoveUser =
        !canonicalHasUser && loserUserIds.length === 1 ? loserUserIds[0] : null;

      const losersHaveAnyUser = loserUserIds.length > 0;

      const safeToDeleteLosers = !losersHaveAnyUser || !!canMoveUser;

      const skipBecauseAmbiguousUsers =
        (canonicalHasUser && losersHaveAnyUser) ||
        (!canonicalHasUser && loserUserIds.length > 1) ||
        !safeToDeleteLosers;

      const deleted_info_ids: string[] = losers.map((r) => r.info_id);
      const from_customer_ids: number[] = losers.map((r) =>
        Number(r.customer_id)
      );

      const { update, copiedFields } = buildCanonicalUpdate(canonical, losers);

      let hubspotConflict: null | {
        desired_hubspot_id: number;
        conflicts: Array<{
          info_id: string;
          customer_id: number | null;
          email: string | null;
          email_norm: string | null;
          created_at: string | null;
        }>;
        conflict_in_same_email_group: boolean;
        conflict_rows_are_all_losers_to_delete: boolean;
      } = null;

      const desiredHubspotId = (update as any).hubspot_id ?? null;

      if (desiredHubspotId !== null && desiredHubspotId !== undefined) {
        const { data: hubRows, error: hubErr } = await supabase
          .from("customer_information")
          .select("info_id, customer_id, email, created_at")
          .eq("hubspot_id", desiredHubspotId);

        if (hubErr) {
          results.push({
            email_norm: g.email_norm,
            status: "error_check_hubspot_id_conflict",
            message: hubErr.message,
            desired_hubspot_id: desiredHubspotId,
          });
          continue;
        }

        const conflictsRaw = ((hubRows || []) as any[])
          .filter((r) => r.info_id !== canonical.info_id)
          .map((r) => ({
            info_id: String(r.info_id),
            customer_id:
              r.customer_id === null || r.customer_id === undefined
                ? null
                : Number(r.customer_id),
            email: typeof r.email === "string" ? r.email : null,
            email_norm: normEmailOrNull(r.email),
            created_at: typeof r.created_at === "string" ? r.created_at : null,
          }));

        if (conflictsRaw.length > 0) {
          const conflictInSameGroup = conflictsRaw.some(
            (r) => r.email_norm === g.email_norm
          );

          const deleteSet = new Set(deleted_info_ids);
          const conflictsAllLosersToDelete = conflictsRaw.every((r) =>
            deleteSet.has(r.info_id)
          );

          hubspotConflict = {
            desired_hubspot_id: Number(desiredHubspotId),
            conflicts: conflictsRaw.slice(0, 10),
            conflict_in_same_email_group: conflictInSameGroup,
            conflict_rows_are_all_losers_to_delete: conflictsAllLosersToDelete,
          };

          if (!conflictsAllLosersToDelete) {
            delete (update as any).hubspot_id;

            results.push({
              email_norm: g.email_norm,
              canonical: {
                info_id: canonical.info_id,
                customer_id: canonical.customer_id,
              },
              status: "skipped_hubspot_id_conflict_outside_group",
              would_copy_fields: copiedFields,
              would_delete_info_ids: deleted_info_ids,
              loser_customer_ids: from_customer_ids,
              hubspot_id_conflict: hubspotConflict,
            });
            continue;
          }
        }
      }

      if (skipBecauseAmbiguousUsers) {
        results.push({
          email_norm: g.email_norm,
          canonical: {
            info_id: canonical.info_id,
            customer_id: canonical.customer_id,
          },
          status: "skipped_ambiguous_user_links",
          canonical_has_user_id: canonicalHasUser,
          loser_user_ids: loserUserIds,
          would_copy_fields: copiedFields,
          would_delete_info_ids: deleted_info_ids,
          loser_customer_ids: from_customer_ids,
          hubspot_id_conflict: hubspotConflict,
        });
        continue;
      }

      if (dry) {
        results.push({
          email_norm: g.email_norm,
          canonical: {
            info_id: canonical.info_id,
            customer_id: canonical.customer_id,
          },
          would_copy_fields: copiedFields,
          would_move_user_id: !!canMoveUser,
          move_user_id_value: canMoveUser,
          would_delete_info_ids: deleted_info_ids,
          loser_customer_ids: from_customer_ids,
          would_set_hubspot_id: (update as any).hubspot_id ?? null,
          hubspot_id_conflict: hubspotConflict,
          status: "dry_run",
        });
        continue;
      }

      if (
        hubspotConflict &&
        hubspotConflict.conflict_rows_are_all_losers_to_delete
      ) {
        const conflictIds = hubspotConflict.conflicts.map((c) => c.info_id);
        if (conflictIds.length > 0) {
          const { error: clrHubErr } = await supabase
            .from("customer_information")
            .update({ hubspot_id: null })
            .in("info_id", conflictIds);

          if (clrHubErr) {
            results.push({
              email_norm: g.email_norm,
              status: "error_clear_conflicting_hubspot_id",
              message: clrHubErr.message,
              hubspot_id_conflict: hubspotConflict,
            });
            continue;
          }
        }
      }

      if (Object.keys(update).length > 0) {
        const { error: upErr } = await supabase
          .from("customer_information")
          .update(update)
          .eq("info_id", canonical.info_id);

        if (upErr) {
          results.push({
            email_norm: g.email_norm,
            status: "error_update_canonical",
            message: upErr.message,
            attempted_update_keys: Object.keys(update),
            attempted_hubspot_id: (update as any).hubspot_id ?? null,
            hubspot_id_conflict: hubspotConflict,
          });
          continue;
        }
      }

      if (canMoveUser) {
        const loserWithUser = losers.find((r) => r.user_id === canMoveUser);
        if (!loserWithUser) {
          results.push({
            email_norm: g.email_norm,
            status: "error_user_move_source_missing",
            hubspot_id_conflict: hubspotConflict,
          });
          continue;
        }

        const { error: clearErr } = await supabase
          .from("customer_information")
          .update({ user_id: null })
          .eq("info_id", loserWithUser.info_id);

        if (clearErr) {
          results.push({
            email_norm: g.email_norm,
            status: "error_clear_loser_user_id",
            message: clearErr.message,
            hubspot_id_conflict: hubspotConflict,
          });
          continue;
        }

        const { error: setErr } = await supabase
          .from("customer_information")
          .update({ user_id: canMoveUser })
          .eq("info_id", canonical.info_id);

        if (setErr) {
          results.push({
            email_norm: g.email_norm,
            status: "error_set_canonical_user_id",
            message: setErr.message,
            hubspot_id_conflict: hubspotConflict,
          });
          continue;
        }
      }

      const { error: delErr } = await supabase
        .from("customer_information")
        .delete()
        .in("info_id", deleted_info_ids);

      if (delErr) {
        results.push({
          email_norm: g.email_norm,
          status: "error_delete_losers",
          message: delErr.message,
          hubspot_id_conflict: hubspotConflict,
        });
        continue;
      }

      results.push({
        email_norm: g.email_norm,
        canonical: {
          info_id: canonical.info_id,
          customer_id: canonical.customer_id,
        },
        copied_fields: copiedFields,
        moved_user_id: !!canMoveUser,
        deleted_info_ids,
        loser_customer_ids: from_customer_ids,
        hubspot_id_conflict: hubspotConflict,
        status: "ok",
      });
    }

    return NextResponse.json({
      ok: true,
      mode: dry ? "dry-run" : "apply",
      scan: {
        pages,
        rows_scanned,
        distinct_emails_seen: byEmail.size,
        duplicate_email_groups: duplicateGroups.length,
      },
      jsonl: {
        path: "exports/customers2.jsonl",
        ...jsonlStats,
      },
      policy: {
        collisions_skipped: collisions.size,
        groups_safe_for_ops: safeGroups.length,
        groups_unsafe: unsafeGroups.length,
        limit_applied: limit,
      },
      unsafe_summary,
      unsafe_groups_logged: unsafeGroups.slice(0, 50),
      collisions_logged: {
        rows: collisionRows.slice(0, 50),
        rows_logged: Math.min(50, collisionRows.length),
        rows_total: collisionRows.length,
      },
      results,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "unhandled", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
