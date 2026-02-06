import { createClient } from "@supabase/supabase-js";
import { netsuiteGetAllProductsQL } from "./get_products/netsuiteGetAllProductsQL";
import { getAllHubspotProducts } from "./get_products/hubspotAllProducts";
import { hubspotAxios } from "./get_products/hubspot";
import { getAllSupabaseProducts } from "./get_products/supabaseAllProducts";

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

async function createHubspotProduct(ns: any) {
  const payload = {
    properties: {
      ns_item_id: ns.id,
      name: ns.name,
      hs_sku: ns.sku,
      description: ns.description || "",
      price: ns.price?.toString() ?? "0",
      hs_images: ns.imageUrl || "",
      hs_product_type: ns.itemType || "",
    },
  };

  const resp = await hubspotAxios.post("/crm/v3/objects/products", payload);

  console.log(
    ` Created HubSpot product ${resp.data.id} for NetSuite ID ${ns.id}`
  );
}

async function updateHubspotProduct(ns: any, hsId: string) {
  const payload = {
    properties: {
      ns_item_id: ns.id,
      name: ns.name,
      hs_sku: ns.sku,
      description: ns.description || "",
      price: ns.price?.toString() ?? "0",
      hs_images: ns.imageUrl || "",
      hs_product_type: ns.itemType || "",
    },
  };

  await hubspotAxios.patch(`/crm/v3/objects/products/${hsId}`, payload);

  console.log(` Updated HubSpot product ${hsId} from NetSuite ID ${ns.id}`);
}

async function createSupabaseProduct(ns: any) {
  const { data, error } = await supabase
    .from("ns_products")
    .insert({
      netsuite_id: ns.id,
      sku: ns.sku,
      name: ns.name || null,
      description: ns.description || null,
      price: ns.price !== null && ns.price !== undefined ? ns.price : null,
      image_url: ns.imageUrl || null,
      item_type: ns.itemType || null,
      raw_item_type: ns.rawItemType || null,
      income_account: ns.incomeAccount || null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Error creating Supabase product: ${error.message}`);
  }

  console.log(` Created Supabase product ${data.id} for NetSuite ID ${ns.id}`);
}

async function updateSupabaseProduct(ns: any, supabaseId: string) {
  const { error } = await supabase
    .from("ns_products")
    .update({
      netsuite_id: ns.id,
      sku: ns.sku,
      name: ns.name || null,
      description: ns.description || null,
      price: ns.price !== null && ns.price !== undefined ? ns.price : null,
      image_url: ns.imageUrl || null,
      item_type: ns.itemType || null,
      raw_item_type: ns.rawItemType || null,
      income_account: ns.incomeAccount || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", supabaseId);

  if (error) {
    throw new Error(`Error updating Supabase product: ${error.message}`);
  }

  console.log(
    ` Updated Supabase product ${supabaseId} from NetSuite ID ${ns.id}`
  );
}

export type CompareOptions = {
  dryRun?: boolean;
};

export async function compareProducts(options: CompareOptions = {}) {
  const dryRun = options.dryRun === true;
  // Fetch NetSuite products
  const nsProducts = await netsuiteGetAllProductsQL();

  // Fetch HubSpot products keyed by ns_item_id
  const hsProductsByNsId = await getAllHubspotProducts();

  // Fetch Supabase products keyed by netsuite_id
  const sbProductsByNsId = await getAllSupabaseProducts();

  console.log(` Loaded ${nsProducts.length} products from NetSuite.`);
  console.log(
    ` Loaded ${Object.keys(hsProductsByNsId).length} products from HubSpot.`
  );
  console.log(
    ` Loaded ${Object.keys(sbProductsByNsId).length} products from Supabase.`
  );

  const hubspotSkus = new Map<string, string>();

  for (const hs of Object.values(hsProductsByNsId)) {
    const sku = hs.properties?.hs_sku;
    if (sku) {
      hubspotSkus.set(sku, hs.id);
    }
  }

  const supabaseSkus = new Map<string, string>();

  for (const sb of Object.values(sbProductsByNsId)) {
    const sku = sb.sku;
    if (sku) {
      supabaseSkus.set(sku, sb.id);
    }
  }

  // Check for duplicate SKUs in NetSuite itself
  const netsuiteSkus = new Map<string, string>();
  for (const ns of nsProducts) {
    if (!ns.sku) continue;
    if (netsuiteSkus.has(ns.sku)) {
      console.log(
        `⚠️ Duplicate SKU in NetSuite export: ${
          ns.sku
        }. Products NS ID ${netsuiteSkus.get(ns.sku)} and ${ns.id}`
      );
    } else {
      netsuiteSkus.set(ns.sku, ns.id);
    }
  }

  const toCreate: any[] = [];
  const toUpdate: any[] = [];
  const inSync: any[] = [];
  const nsSeenIds = new Set<string>();

  const toCreateSupabase: any[] = [];
  const toUpdateSupabase: any[] = [];
  const inSyncSupabase: any[] = [];

  for (const ns of nsProducts) {
    nsSeenIds.add(ns.id);

    // HubSpot comparison
    const hs = hsProductsByNsId[ns.id];
    if (!hs) {
      toCreate.push(ns);
    } else {
      const diffs: Record<string, { ns: any; hs: any }> = {};

      if ((hs.properties.name || "") !== (ns.name || "")) {
        diffs.name = {
          ns: ns.name || "",
          hs: hs.properties.name || "",
        };
      }

      if ((hs.properties.hs_sku || "") !== (ns.sku || "")) {
        diffs.hs_sku = {
          ns: ns.sku || "",
          hs: hs.properties.hs_sku || "",
        };
      }

      if ((hs.properties.description || "") !== (ns.description || "")) {
        diffs.description = {
          ns: ns.description || "",
          hs: hs.properties.description || "",
        };
      }

      const hsPrice = parseFloat(hs.properties.price || "0");
      const nsPrice =
        ns.price !== null && ns.price !== undefined ? ns.price : 0;

      if (hsPrice !== nsPrice) {
        diffs.price = {
          ns: nsPrice,
          hs: hsPrice,
        };
      }

      if ((hs.properties.hs_images || "") !== (ns.imageUrl || "")) {
        diffs.hs_images = {
          ns: ns.imageUrl || "",
          hs: hs.properties.hs_images || "",
        };
      }

      if ((hs.properties.hs_product_type || "") !== (ns.itemType || "")) {
        diffs.hs_product_type = {
          ns: ns.itemType || "",
          hs: hs.properties.hs_product_type || "",
        };
      }

      if (Object.keys(diffs).length > 0) {
        toUpdate.push({
          nsId: ns.id,
          diffs,
          ns,
          hs,
        });
      } else {
        inSync.push(ns);
      }
    }

    // Supabase comparison
    const sb = sbProductsByNsId[ns.id.toString()];
    if (!sb) {
      toCreateSupabase.push(ns);
    } else {
      const diffs: Record<string, { ns: any; sb: any }> = {};

      if ((sb.name || "") !== (ns.name || "")) {
        diffs.name = {
          ns: ns.name || "",
          sb: sb.name || "",
        };
      }

      if ((sb.sku || "") !== (ns.sku || "")) {
        diffs.sku = {
          ns: ns.sku || "",
          sb: sb.sku || "",
        };
      }

      if ((sb.description || "") !== (ns.description || "")) {
        diffs.description = {
          ns: ns.description || "",
          sb: sb.description || "",
        };
      }

      const sbPrice =
        sb.price !== null && sb.price !== undefined ? Number(sb.price) : 0;
      const nsPrice =
        ns.price !== null && ns.price !== undefined ? ns.price : 0;

      if (sbPrice !== nsPrice) {
        diffs.price = {
          ns: nsPrice,
          sb: sbPrice,
        };
      }

      if ((sb.image_url || "") !== (ns.imageUrl || "")) {
        diffs.image_url = {
          ns: ns.imageUrl || "",
          sb: sb.image_url || "",
        };
      }

      if ((sb.item_type || "") !== (ns.itemType || "")) {
        diffs.item_type = {
          ns: ns.itemType || "",
          sb: sb.item_type || "",
        };
      }

      if ((sb.raw_item_type || "") !== (ns.rawItemType || "")) {
        diffs.raw_item_type = {
          ns: ns.rawItemType || "",
          sb: sb.raw_item_type || "",
        };
      }

      if ((sb.income_account || "") !== (ns.incomeAccount || "")) {
        diffs.income_account = {
          ns: ns.incomeAccount || "",
          sb: sb.income_account || "",
        };
      }

      if (Object.keys(diffs).length > 0) {
        toUpdateSupabase.push({
          nsId: ns.id,
          diffs,
          ns,
          sb,
        });
      } else {
        inSyncSupabase.push(ns);
      }
    }
  }

  const toDelete: any[] = [];
  for (const hs of Object.values(hsProductsByNsId)) {
    const nsId = hs.properties?.ns_item_id;
    if (nsId && !nsSeenIds.has(nsId)) {
      toDelete.push(hs);
    }
  }

  console.log("\n PRODUCTS THAT NEED TO BE UPDATED (HubSpot):");
  toUpdate.forEach((p) => {
    console.log(
      `- NS ID ${p.nsId} differences:\n${JSON.stringify(p.diffs, null, 2)}`
    );
  });

  console.log("\n PRODUCTS THAT NEED TO BE UPDATED (Supabase):");
  toUpdateSupabase.forEach((p) => {
    console.log(
      `- NS ID ${p.nsId} differences:\n${JSON.stringify(p.diffs, null, 2)}`
    );
  });

  console.log("\n PRODUCTS THAT NEED TO BE DELETED:");
  toDelete.forEach((p) =>
    console.log(`- HubSpot ID ${p.id}, name: ${p.properties.name}`)
  );

  console.log(
    `\n IN SYNC (HubSpot): ${inSync.length} products are identical in both systems.`
  );
  console.log(
    `\n IN SYNC (Supabase): ${inSyncSupabase.length} products are identical in both systems.`
  );

  console.log("\n🚀 Starting TEST sync...");
  if (dryRun) {
    console.log(" Dry run enabled. Skipping write operations.");
  }

  // HubSpot sync
  if (!dryRun) {
    for (const ns of toCreate) {
      if (!ns.sku) {
        console.log(`⚠️ Skipping NS ID ${ns.id}. Missing SKU.`);
        continue;
      }

      if (hubspotSkus.has(ns.sku)) {
        console.log(
          ` Skipping NS ID ${ns.id}. SKU ${
            ns.sku
          } already exists in HubSpot product ${hubspotSkus.get(ns.sku)}.`
        );
        continue;
      }
      await createHubspotProduct(ns);
      hubspotSkus.set(ns.sku, "newly_created_placeholder");
    }

    for (const update of toUpdate) {
      const newSku = update.ns.sku;
      const currentHsId = update.hs.id;

      // Check if another product has this SKU
      const otherHsId = hubspotSkus.get(newSku);

      if (otherHsId && otherHsId !== currentHsId) {
        console.log(
          ` Skipping update for NS ID ${update.nsId}. SKU ${newSku} already used by another HubSpot product ${otherHsId}.`
        );
        continue;
      }

      await updateHubspotProduct(update.ns, currentHsId);
      hubspotSkus.set(newSku, currentHsId);
    }

    for (const hs of toDelete) {
      console.log(
        ` Skipping delete of HubSpot product ${hs.id} (${hs.properties.name}) during test run.`
      );
      // Uncomment below to actually delete:
      // await deleteHubspotProduct(hs.id);
    }
  }

  // Supabase sync
  if (!dryRun) {
    for (const ns of toCreateSupabase) {
      if (!ns.sku) {
        console.log(`⚠️ Skipping NS ID ${ns.id}. Missing SKU.`);
        continue;
      }

      if (supabaseSkus.has(ns.sku)) {
        console.log(
          ` Skipping NS ID ${ns.id}. SKU ${
            ns.sku
          } already exists in Supabase product ${supabaseSkus.get(ns.sku)}.`
        );
        continue;
      }
      await createSupabaseProduct(ns);
      supabaseSkus.set(ns.sku, "newly_created_placeholder");
    }

    for (const update of toUpdateSupabase) {
      const newSku = update.ns.sku;
      const currentSbId = update.sb.id;

      // Check if another product has this SKU
      const otherSbId = supabaseSkus.get(newSku);

      if (otherSbId && otherSbId !== currentSbId) {
        console.log(
          ` Skipping update for NS ID ${update.nsId}. SKU ${newSku} already used by another Supabase product ${otherSbId}.`
        );
        continue;
      }

      await updateSupabaseProduct(update.ns, currentSbId);
      supabaseSkus.set(newSku, currentSbId);
    }
  }

  console.log("\n TEST sync complete.");

  return {
    netsuiteCount: nsProducts.length,
    hubspotCount: Object.keys(hsProductsByNsId).length,
    supabaseCount: Object.keys(sbProductsByNsId).length,
    toCreate: toCreate.length,
    toUpdate: toUpdate.length,
    toDelete: toDelete.length,
    inSync: inSync.length,
    toCreateSupabase: toCreateSupabase.length,
    toUpdateSupabase: toUpdateSupabase.length,
    inSyncSupabase: inSyncSupabase.length,
    dryRun,
  };
}
