import { createClient } from "@supabase/supabase-js";

const nsWritesSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_NS_WRITES;
const nsWritesSupabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY_NS_WRITES;

if (!nsWritesSupabaseUrl || !nsWritesSupabaseServiceKey) {
  throw new Error(
    "Missing NS writes Supabase env vars: NEXT_PUBLIC_SUPABASE_URL_NS_WRITES or SUPABASE_SERVICE_ROLE_KEY_NS_WRITES"
  );
}

const supabase = createClient(nsWritesSupabaseUrl, nsWritesSupabaseServiceKey, {
  auth: { persistSession: false },
});

export async function getAllSupabaseProducts() {
  let supabaseProductsByNsId: Record<string, any> = {};
  let scanned = 0;
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("ns_products")
      .select(
        "id, netsuite_id, sku, name, description, price, image_url, item_type, raw_item_type, income_account"
      )
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Error fetching Supabase products: ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    for (const p of data) {
      scanned++;
      const nsId = p.netsuite_id?.toString();
      if (nsId) {
        supabaseProductsByNsId[nsId] = p;
      }
    }

    from += pageSize;

    if (data.length < pageSize) {
      break;
    }

    if (scanned % 1000 === 0) {
      console.log(`Fetched ${scanned} Supabase products so far...`);
    }
  }

  console.log(` Finished Fetching ${scanned} Supabase products.`);

  return supabaseProductsByNsId;
}
