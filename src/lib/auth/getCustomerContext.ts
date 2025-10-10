// src/lib/auth/getCustomerContext.ts
import { getServerSupabase } from "@/lib/supabase/server";

export type CustomerContext = {
  netsuite_customer_id: number;
  role: "customer" | "admin";
  email: string;
} | null;

export async function getCustomerContext(): Promise<CustomerContext> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("netsuite_customer_id, role, email")
    .eq("user_id", user.id)
    .single();

  return (profile as CustomerContext) ?? null;
}
