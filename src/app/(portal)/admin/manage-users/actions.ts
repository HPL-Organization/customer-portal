"use server";

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

export interface User {
  id: string;
  email?: string;
  created_at: string;
  last_sign_in_at?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  profile?: {
    netsuite_customer_id?: string;
    role?: string;
    email?: string;
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
    const { data: usersData, error } = await supabase.rpc('get_users_with_profiles', {
      page_param: page,
      limit_param: limit,
      search_term: searchTerm || null
    });

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

    // Transform the data to match the User interface
    const users: User[] = usersData.map((row: UserRow) => {
      // Use customer_information names if available, otherwise fall back to auth metadata
      const firstName = row.customer_first_name ||
        (typeof row.raw_user_meta_data?.first_name === 'string' ? row.raw_user_meta_data.first_name : undefined);
      const lastName = row.customer_last_name ||
        (typeof row.raw_user_meta_data?.last_name === 'string' ? row.raw_user_meta_data.last_name : undefined);

      // Merge names into user_metadata for backward compatibility
      const enhancedUserMetadata = {
        ...row.raw_user_meta_data,
        first_name: firstName,
        last_name: lastName,
      };

      return {
        id: row.id,
        email: row.email,
        created_at: row.created_at,
        last_sign_in_at: row.last_sign_in_at,
        user_metadata: enhancedUserMetadata,
        app_metadata: row.raw_app_meta_data || {},
        profile: row.netsuite_customer_id || row.role || row.profile_email ? {
          netsuite_customer_id: row.netsuite_customer_id,
          role: row.role,
          email: row.profile_email,
        } : null,
      };
    });

    // Get total count from the first row (all rows have the same total_count)
    const totalCount = usersData[0].total_count;
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

export async function deleteUser(userId: string): Promise<{ success: boolean; message: string }> {
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
    const { data: existingUser } = await supabase.auth.admin.getUserById(userId);

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
