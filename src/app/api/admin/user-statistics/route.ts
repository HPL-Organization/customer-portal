import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAdminFromCookies() {
  const cookieStore = await cookies();
  const impCookie = cookieStore.get("imp")?.value;
  const nsIdCookie = cookieStore.get("nsId")?.value;
  return impCookie === "1" && !!nsIdCookie;
}

function getServiceSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type AuthUserRow = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  created_at: string;
  total_revenue?: number;
};

type CustomerInfoRow = {
  customer_id: number | null;
  email: string | null;
};

type InvoiceRow = {
  customer_id: number | null;
  amount_paid: number | string | null;
};

const SORTABLE_FIELDS = new Set([
  "email",
  "first_name",
  "last_name",
  "created_at",
  "total_revenue",
]);

function parseDateStart(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateEnd(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(23, 59, 59, 999);
  return date;
}

export async function GET(req: NextRequest) {
  if (!(await isAdminFromCookies())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const pageParam = Number(searchParams.get("page") || "1");
  const limitParam = Number(searchParams.get("limit") || "25");
  const sortByParam = searchParams.get("sortBy") || "email";
  const sortDirParam = (searchParams.get("sortDir") || "asc").toLowerCase();
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 25;
  const fromDate = parseDateStart(searchParams.get("from"));
  const toDate = parseDateEnd(searchParams.get("to"));
  const sortBy = SORTABLE_FIELDS.has(sortByParam) ? sortByParam : "email";
  const sortDir = sortDirParam === "desc" ? "desc" : "asc";
  const exportFormat = searchParams.get("export");

  const supabase = getServiceSupabase();

  const perPage = 1000;
  let listPage = 1;
  const rows: AuthUserRow[] = [];

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page: listPage,
      perPage,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to list users" },
        { status: 500 }
      );
    }

    const users = data?.users ?? [];
    if (users.length === 0) break;

    for (const u of users) {
      const md = (u.user_metadata ?? {}) as Record<string, unknown>;
      rows.push({
        id: u.id,
        email: u.email ?? "",
        first_name: typeof md.first_name === "string" ? md.first_name : "",
        last_name: typeof md.last_name === "string" ? md.last_name : "",
        created_at: u.created_at ?? "",
      });
    }

    if (users.length < perPage) break;
    listPage += 1;
  }

  const filteredRows = rows.filter((row) => {
    if (!fromDate && !toDate) return true;
    const createdAt = new Date(row.created_at);
    if (Number.isNaN(createdAt.getTime())) return false;
    if (fromDate && createdAt < fromDate) return false;
    if (toDate && createdAt > toDate) return false;
    return true;
  });

  filteredRows.sort((a, b) => a.email.localeCompare(b.email));

  const normalizedEmails = Array.from(
    new Set(
      filteredRows
        .map((row) => row.email.trim().toLowerCase())
        .filter(Boolean)
    )
  );

  const customerIds: number[] = [];
  const customerIdsByEmail = new Map<string, number[]>();
  const emailBatchSize = 500;
  for (let i = 0; i < normalizedEmails.length; i += emailBatchSize) {
    const batch = normalizedEmails.slice(i, i + emailBatchSize);
    const { data, error } = await supabase
      .from("customer_information")
      .select("customer_id, email")
      .in("email", batch);

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to load customer information" },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as CustomerInfoRow[];
    for (const row of rows) {
      if (typeof row.customer_id === "number") {
        customerIds.push(row.customer_id);
        const emailKey = (row.email ?? "").trim().toLowerCase();
        if (emailKey) {
          const existing = customerIdsByEmail.get(emailKey) ?? [];
          existing.push(row.customer_id);
          customerIdsByEmail.set(emailKey, existing);
        }
      }
    }
  }

  const uniqueCustomerIds = Array.from(new Set(customerIds));
  let totalRevenue = 0;
  const revenueByCustomerId = new Map<number, number>();
  const customerBatchSize = 500;
  for (let i = 0; i < uniqueCustomerIds.length; i += customerBatchSize) {
    const batch = uniqueCustomerIds.slice(i, i + customerBatchSize);
    const { data, error } = await supabase
      .from("invoices")
      .select("customer_id, amount_paid")
      .in("customer_id", batch)
      .is("ns_deleted_at", null);

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to load invoices" },
        { status: 500 }
      );
    }

    const invoices = (data ?? []) as InvoiceRow[];
    for (const invoice of invoices) {
      const paid = Number(invoice.amount_paid ?? 0);
      if (!Number.isNaN(paid)) {
        totalRevenue += paid;
        const customerId =
          typeof invoice.customer_id === "number"
            ? invoice.customer_id
            : null;
        if (customerId !== null) {
          const current = revenueByCustomerId.get(customerId) ?? 0;
          revenueByCustomerId.set(customerId, current + paid);
        }
      }
    }
  }

  for (const row of filteredRows) {
    const emailKey = row.email.trim().toLowerCase();
    const ids = customerIdsByEmail.get(emailKey) ?? [];
    let rowRevenue = 0;
    for (const id of ids) {
      rowRevenue += revenueByCustomerId.get(id) ?? 0;
    }
    row.total_revenue = rowRevenue;
  }

  const compareValues = (a: AuthUserRow, b: AuthUserRow) => {
    if (sortBy === "total_revenue") {
      const av = a.total_revenue ?? 0;
      const bv = b.total_revenue ?? 0;
      return av - bv;
    }
    if (sortBy === "created_at") {
      const avRaw = new Date(a.created_at).getTime();
      const bvRaw = new Date(b.created_at).getTime();
      const av = Number.isNaN(avRaw) ? 0 : avRaw;
      const bv = Number.isNaN(bvRaw) ? 0 : bvRaw;
      return av - bv;
    }
    const av = String(a[sortBy as keyof AuthUserRow] ?? "").toLowerCase();
    const bv = String(b[sortBy as keyof AuthUserRow] ?? "").toLowerCase();
    return av.localeCompare(bv);
  };

  filteredRows.sort((a, b) => {
    const diff = compareValues(a, b);
    return sortDir === "desc" ? -diff : diff;
  });

  if (exportFormat === "csv") {
    const csvEscape = (value: unknown) => {
      const s = value == null ? "" : String(value);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = [
      "email",
      "first_name",
      "last_name",
      "total_revenue",
      "created_at",
    ];
    const lines = [
      header.map(csvEscape).join(","),
      ...filteredRows.map((row) =>
        [
          row.email,
          row.first_name,
          row.last_name,
          row.total_revenue ?? 0,
          row.created_at,
        ]
          .map(csvEscape)
          .join(",")
      ),
    ];
    const csv = lines.join("\r\n");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `user_statistics_${timestamp}.csv`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const totalCount = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const startIndex = (page - 1) * limit;
  const pagedUsers = filteredRows.slice(startIndex, startIndex + limit);

  return NextResponse.json({
    users: pagedUsers,
    totalCount,
    page,
    limit,
    totalPages,
    totalRevenue,
  });
}
