import axios from "axios";
import { getValidToken } from "../../netsuite/token";

const NETSUITE_ACCOUNT_ID = process.env.NETSUITE_ACCOUNT_ID!;
const NETSUITE_BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

/**
 * Runs a SuiteQL query and returns all rows across pages.
 */
async function runSuiteQL(query: string, accessToken: string): Promise<any[]> {
  let allItems: any[] = [];
  let url = `${NETSUITE_BASE_URL}/query/v1/suiteql`;
  let payload = { q: query };

  while (url) {
    console.log("Running SuiteQL query at:", url);

    const resp = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "transient",
      },
      timeout: 60000,
    });

    const items = resp.data.items ?? [];
    allItems.push(...items);

    const nextLink = resp.data.links?.find((l: any) => l.rel === "next");
    if (nextLink?.href) {
      url = nextLink.href;
      payload = { q: query };
    } else {
      url = "";
    }
  }

  return allItems;
}

/**
 * Main method to fetch products from NetSuite.
 */
export async function netsuiteGetAllProductsQL(): Promise<any[]> {
  const accessToken = await getValidToken();

  const suiteQL = `
  SELECT
    item.id,
    item.itemid,
    item.displayname,
    item.description,
    item.itemtype,
    item.incomeaccount,
    pricing.unitprice AS baseprice,
    file.id AS fileid,
    file.name AS filename,
    file.url AS fileurl
  FROM
    item
  LEFT JOIN
    Pricing
      ON Pricing.Item = item.id
      AND Pricing.PriceLevel = 1
  LEFT JOIN
    file
      ON item.custitem_atlas_item_image = file.id
  WHERE
    item.isinactive = 'F'
`;

  const rows = await runSuiteQL(suiteQL, accessToken);

  const products = rows
    .map((item) => {
      let fullImageUrl: null | string = null;

      if (item.fileurl) {
        fullImageUrl = `https://${NETSUITE_ACCOUNT_ID}.app.netsuite.com${item.fileurl}`;
      }
      const mappedType = mapNsTypeToReadable(item.itemtype);

      return {
        netsuiteType: "item",
        id: item.id,
        sku: item.itemid,
        name: item.displayname,
        description: item.description || null,
        price:
          item.baseprice !== undefined && item.baseprice !== null
            ? Number(item.baseprice)
            : null,
        imageUrl: fullImageUrl,
        itemType: mappedType,
        rawItemType: item.itemtype || null,
        incomeAccount: item.incomeaccount || null,
      };
    })
    .filter((item) => item.itemType !== null && item.incomeAccount !== null);

  console.log(` Loaded ${products.length} products via SuiteQL`);
  console.log(
    " Sample results:\n",
    JSON.stringify(products.slice(0, 5), null, 2)
  );

  return products;
}
function mapNsTypeToReadable(type: string | null): string | null {
  if (!type) return null;
  switch (type) {
    case "InvtPart":
      return "inventory";
    case "NonInvtPart":
      return "non_inventory";
    case "Service":
      return "service";
    case "Kit":
      return "inventory";
    case "Assembly":
      return "inventory";
    case "OthCharge":
      return "non_inventory";
    default:
      return null;
  }
}
