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

    // Fetch all users for search and filtering - Supabase doesn't support metadata search directly
    const { data: allUsersData, error } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000, // Reasonable limit for admin interface
    });

    if (error) {
      console.error("Error fetching users:", error);
      throw new Error("Failed to fetch users");
    }

    if (!allUsersData?.users) {
      return {
        users: [],
        totalCount: 0,
        page,
        limit,
        totalPages: 0,
      };
    }

    // For each user, also fetch their profile data if available
    const usersWithProfiles = await Promise.all(
      allUsersData.users.map(async (user) => {
        const { data: profile } = await supabase
          .from("profiles")
          .select("netsuite_customer_id, role, email")
          .eq("user_id", user.id)
          .single();

        return {
          id: user.id,
          email: user.email,
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at,
          user_metadata: user.user_metadata,
          app_metadata: user.app_metadata,
          profile: profile || null,
        };
      })
    );

    // Filter users based on search term if provided
    let filteredUsers = usersWithProfiles;
    if (searchTerm && searchTerm.trim()) {
      const search = searchTerm.toLowerCase().trim();
      filteredUsers = usersWithProfiles.filter(user => {
        const email = user.email?.toLowerCase() ?? '';
        const fullName = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.toLowerCase() : '';
        const name = typeof user.user_metadata?.name === 'string' ? user.user_metadata.name.toLowerCase() : '';
        const displayName = typeof user.user_metadata?.display_name === 'string' ? user.user_metadata.display_name.toLowerCase() : '';

        return email.includes(search) ||
               fullName.includes(search) ||
               name.includes(search) ||
               displayName.includes(search);
      });
    }

    // Apply pagination to filtered results
    const totalCount = filteredUsers.length;
    const totalPages = Math.ceil(totalCount / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedUsers = filteredUsers.slice(startIndex, endIndex);

    return {
      users: paginatedUsers,
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
