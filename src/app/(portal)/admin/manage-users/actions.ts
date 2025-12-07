"use server";

import { getCustomerCache } from "@/lib/cache";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function getAdminSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export interface InvoiceDateParts {
  month: number;
  day: number;
  year: number;
}

export interface InvoiceRange {
  mode?: "rolling" | "fixed";
  from?: InvoiceDateParts | null;
  to?: InvoiceDateParts | null;
}

export interface User {
  id: string;
  email?: string | null;
  created_at: string;
  last_sign_in_at?: string | null;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  profile?: {
    netsuite_customer_id?: number | null;
    role?: string | null;
    email?: string | null;
  } | null;
  invoiceSettings?: {
    checkInvoice: boolean;
    range?: InvoiceRange | null;
  } | null;
}

export interface PaginatedUsersResult {
  users: User[];
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface UserRow {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  raw_user_meta_data: Record<string, unknown> | null;
  raw_app_meta_data: Record<string, unknown> | null;
  netsuite_customer_id: number | null;
  role: string | null;
  profile_email: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  total_count: number;
}

interface InvoiceSettingsRow {
  user_id: string | null;
  customer_id: number | null;
  check_invoice: boolean | null;
  check_invoice_range: unknown;
}

interface CustomerInfoRow {
  info_id: number;
  email: string;
}

function sanitizeInvoiceRange(
  range?: InvoiceRange | null
): InvoiceRange | null {
  if (!range) {
    return null;
  }

  const sanitized: InvoiceRange = {};

  if (range.mode === "rolling" || range.mode === "fixed") {
    sanitized.mode = range.mode;
  }

  if (range.from && isInvoiceDateParts(range.from)) {
    sanitized.from = range.from;
  }

  if (range.to && isInvoiceDateParts(range.to)) {
    sanitized.to = range.to;
  }

  if (!sanitized.mode && !sanitized.from && !sanitized.to) {
    return null;
  }

  if (!sanitized.mode && (sanitized.from || sanitized.to)) {
    sanitized.mode = "fixed";
  }

  return sanitized;
}

function isInvoiceDateParts(value: unknown): value is InvoiceDateParts {
  if (
    !value ||
    typeof value !== "object" ||
    !("month" in value) ||
    !("day" in value) ||
    !("year" in value)
  ) {
    return false;
  }

  const parts = value as Record<string, unknown>;
  return (
    typeof parts.month === "number" &&
    typeof parts.day === "number" &&
    typeof parts.year === "number"
  );
}

function normalizeInvoiceRange(range: unknown): InvoiceRange | null {
  if (!range || typeof range !== "object") {
    return null;
  }

  const raw = range as Record<string, unknown>;
  const normalized: InvoiceRange = {};

  if (raw.mode === "rolling" || raw.mode === "fixed") {
    normalized.mode = raw.mode;
  }

  if (raw.from && isInvoiceDateParts(raw.from)) {
    normalized.from = raw.from;
  }

  if (raw.to && isInvoiceDateParts(raw.to)) {
    normalized.to = raw.to;
  }

  if (!normalized.mode && !normalized.from && !normalized.to) {
    return null;
  }

  if (!normalized.mode && (normalized.from || normalized.to)) {
    normalized.mode = "fixed";
  }

  return normalized;
}

export async function fetchUsers(
  page: number = 1,
  limit: number = 25,
  searchTerm?: string
): Promise<PaginatedUsersResult> {
  try {
    // Check for admin cookies (same logic as /api/auth/me)
    const cookieStore = await cookies();
    const impCookie = cookieStore.get("imp")?.value;
    const nsIdCookie = cookieStore.get("nsId")?.value;
    const isAdmin = impCookie === "1" && !!nsIdCookie;

    if (!isAdmin) {
      throw new Error("Unauthorized");
    }

    const supabase = getAdminSupabase();

    // Fetch users with their profiles using the RPC function with pagination and search
    const { data: usersData, error } = await supabase.rpc(
      "get_users_with_profiles",
      {
        page_param: page,
        limit_param: limit,
        search_term: searchTerm || null,
      }
    );

    if (error) {
      console.error("Error fetching users:", error);
      throw new Error("Failed to fetch users");
    }

    if (!usersData || usersData.length === 0) {
      return {
        users: [],
        totalCount: 0,
        page,
        limit,
        totalPages: 0,
      };
    }

    const typedRows = usersData as UserRow[];

    const userIds = typedRows.map((row) => row.id);
    const netsuiteIds = typedRows
      .map((row) => row.netsuite_customer_id)
      .filter(
        (id): id is number => typeof id === "number" && !Number.isNaN(id)
      );

    const selectColumns =
      "user_id, customer_id, check_invoice, check_invoice_range";
    const invoiceRows: InvoiceSettingsRow[] = [];

    if (userIds.length > 0) {
      const { data, error: invoiceByUserError } = await supabase
        .from("customer_information")
        .select(selectColumns)
        .in("user_id", userIds);

      if (invoiceByUserError) {
        console.error(
          "Error loading invoice settings by user:",
          invoiceByUserError
        );
        throw new Error("Failed to fetch invoice settings");
      }

      if (data) {
        invoiceRows.push(...data);
      }
    }

    if (netsuiteIds.length > 0) {
      const { data, error: invoiceByCustomerError } = await supabase
        .from("customer_information")
        .select(selectColumns)
        .in("customer_id", netsuiteIds);

      if (invoiceByCustomerError) {
        console.error(
          "Error loading invoice settings by customer:",
          invoiceByCustomerError
        );
        throw new Error("Failed to fetch invoice settings");
      }

      if (data) {
        invoiceRows.push(...data);
      }
    }

    const invoiceByUserId = new Map<string, InvoiceSettingsRow>();
    const invoiceByCustomerId = new Map<number, InvoiceSettingsRow>();

    for (const row of invoiceRows) {
      if (row.user_id) {
        invoiceByUserId.set(row.user_id, row);
      }

      if (typeof row.customer_id === "number") {
        invoiceByCustomerId.set(row.customer_id, row);
      }
    }

    // Transform the data to match the User interface
    const users: User[] = typedRows.map((row) => {
      // Use customer_information names if available, otherwise fall back to auth metadata
      const firstName =
        row.customer_first_name ||
        (typeof row.raw_user_meta_data?.first_name === "string"
          ? row.raw_user_meta_data.first_name
          : undefined);
      const lastName =
        row.customer_last_name ||
        (typeof row.raw_user_meta_data?.last_name === "string"
          ? row.raw_user_meta_data.last_name
          : undefined);

      // Merge names into user_metadata for backward compatibility
      const enhancedUserMetadata = {
        ...row.raw_user_meta_data,
        first_name: firstName,
        last_name: lastName,
      };

      const invoiceRow =
        invoiceByUserId.get(row.id) ||
        (typeof row.netsuite_customer_id === "number"
          ? invoiceByCustomerId.get(row.netsuite_customer_id)
          : undefined);

      return {
        id: row.id,
        email: row.email,
        created_at: row.created_at,
        last_sign_in_at: row.last_sign_in_at,
        user_metadata: enhancedUserMetadata,
        app_metadata: row.raw_app_meta_data || {},
        profile:
          row.netsuite_customer_id || row.role || row.profile_email
            ? {
                netsuite_customer_id: row.netsuite_customer_id,
                role: row.role,
                email: row.profile_email,
              }
            : null,
        invoiceSettings: invoiceRow
          ? {
              checkInvoice: !!invoiceRow.check_invoice,
              range: normalizeInvoiceRange(invoiceRow.check_invoice_range),
            }
          : null,
      };
    });

    // Get total count from the first row (all rows have the same total_count)
    const totalCount = typedRows[0].total_count;
    const totalPages = Math.ceil(totalCount / limit);

    return {
      users,
      totalCount,
      page,
      limit,
      totalPages,
    };
  } catch (error) {
    console.error("Error in fetchUsers server action:", error);
    throw error;
  }
}

async function findCustomerInfoRow(
  supabase: ReturnType<typeof getAdminSupabase>,
  userId: string,
  netsuiteCustomerId?: number | null
) {
  const selectColumns = "info_id,email";

  if (userId) {
    const { data, error } = await supabase
      .from("customer_information")
      .select(selectColumns)
      .eq("user_id", userId)
      .maybeSingle();

    if (!error && data) {
      return data;
    }
  }

  if (netsuiteCustomerId) {
    const { data, error } = await supabase
      .from("customer_information")
      .select(selectColumns)
      .eq("customer_id", netsuiteCustomerId)
      .maybeSingle();

    if (!error && data) {
      return data;
    }
  }

  return null;
}

export async function upsertCustomerInvoiceSettings(params: {
  userId: string;
  netsuiteCustomerId?: number | null;
  checkInvoice: boolean;
  range?: InvoiceRange | null;
}): Promise<{ success: boolean }> {
  try {
    const cookieStore = await cookies();
    const impCookie = cookieStore.get("imp")?.value;
    const nsIdCookie = cookieStore.get("nsId")?.value;
    const isAdmin = impCookie === "1" && !!nsIdCookie;

    if (!isAdmin) {
      throw new Error("Unauthorized");
    }

    if (!params.userId) {
      throw new Error("User ID is required");
    }

    const supabase = getAdminSupabase();
    const range = sanitizeInvoiceRange(params.range ?? null);

    const updatePayload = {
      check_invoice: params.checkInvoice,
      check_invoice_range: range,
    };

    const existing = await findCustomerInfoRow(
      supabase,
      params.userId,
      params.netsuiteCustomerId ?? null
    );

    if (!existing) {
      console.info(
        "No existing customer_information row; skipping invoice settings upsert",
        {
          userId: params.userId,
          netsuiteCustomerId: params.netsuiteCustomerId ?? null,
        }
      );
      return { success: true };
    }

    const { error } = await supabase
      .from("customer_information")
      .update(updatePayload)
      .eq("info_id", (existing as CustomerInfoRow).info_id)
      .select("info_id")
      .maybeSingle();

    if (error) {
      console.error("Error updating invoice settings:", error);
      throw new Error("Failed to update invoice settings");
    }

    // Invalidate customer cache after successful update
    const customerCache = getCustomerCache();
    // await customerCache.invalidateCustomerByEmail((existing as CustomerInfoRow).email);

    return { success: true };
  } catch (error) {
    console.error("Error in upsertCustomerInvoiceSettings:", error);
    throw error;
  }
}
export async function applyGlobalInvoiceSettings(params: {
  checkInvoice: boolean;
  range?: InvoiceRange | null;
}): Promise<{ success: boolean; updated: number }> {
  try {
    const cookieStore = await cookies();
    const impCookie = cookieStore.get("imp")?.value;
    const nsIdCookie = cookieStore.get("nsId")?.value;
    const isAdmin = impCookie === "1" && !!nsIdCookie;

    if (!isAdmin) {
      throw new Error("Unauthorized");
    }

    const supabase = getAdminSupabase();
    const range = sanitizeInvoiceRange(params.range ?? null);

    const { data, error } = await supabase
      .from("customer_information")
      .update({
        check_invoice: params.checkInvoice,
        check_invoice_range: range,
      })
      .not("customer_id", "is", null)
      .select("info_id");

    if (error) {
      console.error("Error applying global invoice settings:", error);
      throw new Error("Failed to apply global invoice settings");
    }

    return {
      success: true,
      updated: data?.length ?? 0,
    };
  } catch (error) {
    console.error("Error in applyGlobalInvoiceSettings:", error);
    throw error;
  }
}

export async function deleteUser(
  userId: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Check for admin cookies (same logic as /api/auth/me)
    const cookieStore = await cookies();
    const impCookie = cookieStore.get("imp")?.value;
    const nsIdCookie = cookieStore.get("nsId")?.value;
    const isAdmin = impCookie === "1" && !!nsIdCookie;

    if (!isAdmin) {
      throw new Error("Unauthorized");
    }

    if (!userId) {
      throw new Error("User ID is required");
    }

    const supabase = getAdminSupabase();

    // Check if user exists first
    const { data: existingUser } = await supabase.auth.admin.getUserById(
      userId
    );

    if (!existingUser.user) {
      throw new Error("User not found");
    }

    // Prevent deleting admin users (basic protection)
    if (existingUser.user.id === nsIdCookie) {
      throw new Error("Cannot delete your own admin account");
    }

    // Delete the user from auth.users (this will cascade delete from profiles due to foreign key)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error("Error deleting user:", deleteError);
      throw new Error("Failed to delete user");
    }

    return { success: true, message: "User deleted successfully" };
  } catch (error) {
    console.error("Error in deleteUser server action:", error);
    throw error;
  }
}
