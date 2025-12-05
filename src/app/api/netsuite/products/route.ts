// app/api/netsuite/products/route.ts
import { getValidToken } from "@/lib/netsuite/token";
import axios from "axios";
import { NextRequest } from "next/server";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

const http = axios.create({ timeout: 60000 });

async function netsuiteQuery(
  q: string,
  headers: Record<string, string>,
  tag?: string
) {
  const delays = [500, 1000, 2000, 4000, 8000];
  let attempt = 0;
  for (;;) {
    try {
      return await http.post(
        `${BASE_URL}/query/v1/suiteql`,
        { q },
        { headers }
      );
    } catch (err: any) {
      const status = err?.response?.status;
      const code =
        err?.response?.data?.["o:errorDetails"]?.[0]?.["o:errorCode"];
      const transient =
        status === 429 ||
        code === "CONCURRENCY_LIMIT_EXCEEDED" ||
        (status >= 500 && status < 600) ||
        err?.code === "ECONNABORTED";
      if (transient) {
        const d = delays[Math.min(attempt, delays.length - 1)];
        await new Promise((r) => setTimeout(r, d));
        attempt++;
        continue;
      }
      const e = new Error("SuiteQL " + (tag || "") + " failed");
      (e as any).details = {
        tag,
        status,
        code,
        detail:
          err?.response?.data?.["o:errorDetails"]?.[0]?.detail ||
          err?.response?.data,
        q,
      };
      throw e;
    }
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const skuParam = url.searchParams.get("sku");
    const skusCsv = url.searchParams.get("skus");

    // Validate that at least one SKU parameter is provided
    if (!skuParam && !skusCsv) {
      return new Response(
        JSON.stringify({
          error: "Missing required parameter: either 'sku' or 'skus' must be provided"
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Parse SKUs
    let skus: string[] = [];
    if (skusCsv) {
      skus = skusCsv
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else if (skuParam) {
      skus = [skuParam.trim()];
    }

    if (skus.length === 0) {
      return new Response(
        JSON.stringify({ error: "No valid SKUs provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Limit to prevent excessive queries
    if (skus.length > 100) {
      return new Response(
        JSON.stringify({ error: "Too many SKUs requested. Maximum 100 allowed." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get authentication token
    const token = await getValidToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "transient, maxpagesize=1000",
    } as Record<string, string>;

    // Build the WHERE clause for SKU matching
    const skuConditions = skus.map((sku) => `I.itemid = '${sku.replace(/'/g, "''")}'`);
    const whereClause = skuConditions.join(" OR ");

    // Query for products by SKU
    const query = `
      SELECT
        I.id AS itemId,
        I.itemid AS sku,
        I.displayname AS displayName,
        I.description AS description,
        I.upccode AS barcode,
        I.quantityavailable AS quantityAvailable,
        I.quantityonhand AS quantityOnHand,
        I.quantitycommitted AS quantityCommitted,
        I.quantitybackordered AS quantityBackordered,
        I.isinactive AS isInactive
      FROM item I
      WHERE (${whereClause})
      ORDER BY I.itemid
    `;

    const response = await netsuiteQuery(query, headers, "productLookup");
    const items = response?.data?.items || [];

    // Transform the results
    const products = items.map((item: any) => ({
      itemId: item.itemid != null ? Number(item.itemid) : null,
      sku: item.sku ?? null,
      displayName: item.displayname ?? null,
      description: item.description ?? null,
      barcode: item.barcode ?? null,
      quantityAvailable: item.quantityavailable != null ? Number(item.quantityavailable) : null,
      quantityOnHand: item.quantityonhand != null ? Number(item.quantityonhand) : null,
      quantityCommitted: item.quantitycommitted != null ? Number(item.quantitycommitted) : null,
      quantityBackordered: item.quantitybackordered != null ? Number(item.quantitybackordered) : null,
      isInactive: item.isinactive === "T" || item.isinactive === true,
    }));

    // Create a lookup map for easy reference
    const productsBySku = products.reduce((acc: any, product: any) => {
      if (product.sku) {
        acc[product.sku] = product;
      }
      return acc;
    }, {});

    // Check for SKUs that weren't found
    const foundSkus = new Set(products.map((p: any) => p.sku));
    const notFoundSkus = skus.filter((sku) => !foundSkus.has(sku));

    return new Response(
      JSON.stringify({
        success: true,
        requestedSkus: skus,
        foundCount: products.length,
        notFoundCount: notFoundSkus.length,
        notFoundSkus: notFoundSkus,
        products: products,
        productsBySku: productsBySku,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );

  } catch (error: any) {
    console.error("Product lookup error:", error);

    return new Response(
      JSON.stringify({
        error: "Failed to lookup products",
        message: error.message,
        details: error.details || null,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
