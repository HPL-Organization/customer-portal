import { hubspotAxios } from "./hubspot";

type HubspotProduct = {
  id: string;
  properties: {
    ns_item_id?: string;
    name?: string;
    price?: string;
    description?: string;
    hs_sku?: string;
    hs_images?: string;
    hs_product_type?: string;
  };
};

type HubspotProductsResponse = {
  results: HubspotProduct[];
  paging?: {
    next?: {
      after?: string;
    };
  };
};

export async function getAllHubspotProducts() {
  let after: string | undefined = undefined;
  let hubspotProductsByNsId: Record<string, HubspotProduct> = {};
  let scanned = 0;

  do {
    // const url = after
    //   ? `/crm/v3/objects/products?limit=100&properties=ns_item_id,name,price,description&after=${after}`
    //   : `/crm/v3/objects/products?limit=100&properties=ns_item_id,name,price,description`;
    const url: string = after
      ? `/crm/v3/objects/products?limit=100&properties=ns_item_id,name,price,description,hs_sku,hs_images,hs_product_type&after=${after}`
      : `/crm/v3/objects/products?limit=100&properties=ns_item_id,name,price,description,hs_sku,hs_images,hs_product_type`;

    const response: { data: HubspotProductsResponse } =
      await hubspotAxios.get(url);
    const products = response.data.results ?? [];

    for (const p of products) {
      scanned++;
      const nsId = p.properties?.ns_item_id;
      if (nsId) {
        hubspotProductsByNsId[nsId] = p;
      }
    }

    after = response.data.paging?.next?.after;

    if (scanned % 1000 === 0) {
      console.log(`Fetched ${scanned} products so far...`);
    }
  } while (after);

  console.log(` Finished Fetching ${scanned} HubSpot products.`);

  return hubspotProductsByNsId;
}
