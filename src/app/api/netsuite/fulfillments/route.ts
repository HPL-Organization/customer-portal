"use server";

import { NextRequest } from "next/server";
import axios from "axios";
import { getValidToken } from "../../../../lib/netsuite/token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

export async function GET(req: NextRequest) {
  const customerId = req.nextUrl.searchParams.get("customerId");
  if (!customerId) {
    return new Response(JSON.stringify({ error: "Missing customerId" }), {
      status: 400,
    });
  }

  const numericId = Number(customerId);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return new Response(JSON.stringify({ error: "Invalid customerId" }), {
      status: 400,
    });
  }

  try {
    const token = await getValidToken();

    const fulfillmentQuery = `
      SELECT
        T.id,
        T.tranid,
        T.trandate
      FROM transaction T
      WHERE T.type = 'ItemShip'
        AND T.entity = ${numericId}
      ORDER BY T.trandate DESC
    `;

    const fulfillmentRes = await axios.post(
      `${BASE_URL}/query/v1/suiteql`,
      { q: fulfillmentQuery },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          Prefer: "transient",
        },
      }
    );

    const uniqueFulfillments = Array.from(
      new Map(
        (fulfillmentRes.data?.items ?? []).map((it: any) => [it.id, it])
      ).values()
    );

    const fulfillmentsWithItems = await Promise.all(
      uniqueFulfillments.map(async (ff: any) => {
        const lineItemQuery = `
  SELECT
    TL.transaction AS fulfillmentid,
    I.itemid AS itemsku,
    I.displayname AS itemdisplayname,
    TL.quantity,
    TL.custcol_hpl_serialnumber AS serialnumber,
    TL.custcolns_comment AS comment
  FROM transactionline TL
  INNER JOIN item I ON I.id = TL.item
  WHERE TL.transaction = ${ff.id}
`;

        const lineRes = await axios.post(
          `${BASE_URL}/query/v1/suiteql`,
          { q: lineItemQuery },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "Content-Type": "application/json",
              Prefer: "transient",
            },
          }
        );

        let shipStatus = "";
        let fulfillmentStatus = "";
        let tracking = "";
        let trackingUrls: string[] = [];
        let trackingDetails: {
          number: string;
          carrier: string;
          url: string;
        }[] = [];

        let salesOrderId: string | number | null = null;
        let salesOrderTranId: string | null = null;

        try {
          const detailRes = await axios.get(
            `${BASE_URL}/record/v1/itemFulfillment/${ff.id}?expandSubResources=true`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
              },
            }
          );

          const d = detailRes.data || {};
          shipStatus = d.shipStatus?.refName || "";
          fulfillmentStatus = d.status?.refName || "";

          const cf = extractCreatedFrom(d);
          if (cf.id != null) salesOrderId = cf.id;
          if (cf.tranId) salesOrderTranId = cf.tranId;

          const carrierFromRecord = extractCarrierName(d);
          const packagesRaw =
            d.packageList?.packages ?? d.packageList ?? d.packages ?? [];
          const pkgs = Array.isArray(packagesRaw)
            ? packagesRaw
            : [packagesRaw].filter(Boolean);

          const numbers: string[] = [];
          for (const pkg of pkgs) {
            const num =
              pkg?.packageTrackingNumber ||
              pkg?.trackingNumber ||
              pkg?.packageTrackingNo ||
              "";
            if (num) numbers.push(String(num));
          }
          if (!numbers.length) numbers.push(...collectTrackingStrings(d));

          const details = numbers.map((num) => {
            const pkg = pkgForNumber(pkgs, num);
            const carrier =
              carrierFromRecord ||
              carrierFromPackage(pkg) ||
              inferCarrierFromNumber(num) ||
              "";
            const url = pkgTrackingUrl(pkg) || buildTrackingUrl(carrier, num);
            return { number: num, carrier, url };
          });

          trackingDetails = dedupeDetails(details);
          tracking = trackingDetails.map((p) => p.number).join(", ");
          trackingUrls = trackingDetails.map((p) => p.url);
        } catch (e: any) {
          console.warn(
            `itemFulfillment ${ff.id} detail fetch failed`,
            e?.response?.data || e?.message
          );
        }

        if (salesOrderId && !salesOrderTranId) {
          try {
            const soTranId = await fetchTranIdById(token, salesOrderId);
            if (soTranId) salesOrderTranId = soTranId;
          } catch (_) {}
        }

        const grouped = new Map<
          string,
          {
            sku: string;
            productName: string;
            quantity: number;
            serialNumbers: string[];
            comments: string[];
          }
        >();

        for (const line of lineRes.data?.items ?? []) {
          const key = `${line.itemsku}::${line.itemdisplayname}`;
          const serial =
            line.serialnumber ??
            line.SerialNumber ??
            line.custcol_hpl_serialnumber ??
            null;
          const comment = line.comment ?? line.custcolns_comment ?? null;

          if (!grouped.has(key)) {
            grouped.set(key, {
              sku: line.itemsku,
              productName: line.itemdisplayname,
              quantity: Math.abs(parseFloat(line.quantity ?? 0)),
              serialNumbers: serial ? [String(serial)] : [],
              comments: comment ? [String(comment)] : [],
            });
          } else {
            const g = grouped.get(key)!;
            g.quantity += Math.abs(parseFloat(line.quantity ?? 0));
            if (serial) g.serialNumbers.push(String(serial));
            if (comment) g.comments.push(String(comment));
          }
        }

        // --- Order-first display fields ---
        const orderNumber = normalizeSOTranId(salesOrderTranId);
        const fulfillmentNumber = ff.tranid;
        const number = orderNumber
          ? `${orderNumber} • ${fulfillmentNumber}`
          : fulfillmentNumber;
        const items = Array.from(grouped.values()).map((x) => ({
          ...x,
          serialNumbers: Array.from(new Set(x.serialNumbers)),
          comments: Array.from(new Set(x.comments)),
          tracking,
        }));
        return {
          id: ff.id,
          number, // e.g., "SO-521210 • IF-556"
          orderNumber, // e.g., "SO-521210"
          fulfillmentNumber, // e.g., "IF-556"
          shippedAt: ff.trandate,
          shipStatus,
          status: fulfillmentStatus,
          tracking,
          trackingUrls,
          trackingDetails,
          salesOrderId: salesOrderId ?? null,
          salesOrderTranId: salesOrderTranId ?? null,
          items,
        };
      })
    );

    return new Response(
      JSON.stringify({ fulfillments: fulfillmentsWithItems }),
      { status: 200 }
    );
  } catch (error: any) {
    console.error(
      "Failed to fetch fulfillments by customer:",
      error?.response?.data || error?.message
    );
    return new Response(
      JSON.stringify({ error: "Failed to fetch fulfillments" }),
      { status: 500 }
    );
  }
}

/* ----------------- helpers ----------------- */

function extractCreatedFrom(d: any): {
  id: string | number | null;
  tranId: string;
} {
  const cf = d?.createdFrom ?? d?.createdfrom ?? null;
  const id = (cf && (cf.id ?? cf.refId ?? cf.value)) ?? null;
  const tranId = (cf && (cf.refName ?? cf.text ?? cf.name)) ?? "";
  return { id, tranId };
}

async function fetchTranIdById(
  token: string,
  id: string | number
): Promise<string | null> {
  const q = `SELECT tranid FROM transaction WHERE id = ${id}`;
  const res = await axios.post(
    `${BASE_URL}/query/v1/suiteql`,
    { q },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "transient",
      },
    }
  );
  const row = res.data?.items?.[0];
  return row?.tranid ?? null;
}

function normalizeSOTranId(raw: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/\bSO[-\d]+\b/i);
  if (m) return m[0].toUpperCase();
  return s.replace(/sales\s*order\s*#?/i, "").trim() || s;
}

function extractCarrierName(d: any): string {
  const pick = (x: any) =>
    (x &&
      typeof x === "object" &&
      (x.refName || x.text || x.name || x.value)) ||
    (typeof x === "string" && x) ||
    "";

  const candidates = [
    d.shipCarrier,
    d.shipcarrier,
    d.shipMethod?.carrier,
    d.shipmethod?.carrier,
    d.shipMethod,
    d.carrier,
    d.shippingCarrier,
  ];

  for (const c of candidates) {
    const v = pick(c);
    if (v) return String(v).toLowerCase();
  }

  const packagesRaw =
    d.packageList?.packages ?? d.packageList ?? d.packages ?? [];
  const pkgs = Array.isArray(packagesRaw)
    ? packagesRaw
    : [packagesRaw].filter(Boolean);
  for (const p of pkgs) {
    const v = p?.packageCarrier || p?.carrier || p?.packageShipCarrier;
    if (v) return String(v).toLowerCase();
  }

  return "";
}

function carrierFromPackage(pkg: any): string {
  if (!pkg) return "";
  const v =
    pkg.packageCarrier ||
    pkg.carrier ||
    pkg.packageShipCarrier ||
    pkg.shipCarrier ||
    pkg.shipMethod?.carrier ||
    "";
  return String(v || "").toLowerCase();
}

function inferCarrierFromNumber(num: string): string {
  const n = (num || "").replace(/\s+/g, "").toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return "ups";
  if (/^[A-Z]{2}\d{9}US$/.test(n)) return "usps";
  if (/^\d{20,22}$/.test(n)) {
    if (/^9\d{19,21}$/.test(n)) return "usps";
    return "fedex";
  }
  if (/^\d{12}$/.test(n) || /^\d{15}$/.test(n)) return "fedex";
  if (/^\d{10}$/.test(n) || /^JJD\d+$/i.test(n) || /^JVGL\d+$/i.test(n))
    return "dhl";
  if (/^C\d{12}$/i.test(n)) return "ontrac";
  return "";
}

function buildTrackingUrl(carrier: string, num: string): string {
  if (!num) return "";
  const n = encodeURIComponent(num);
  const c = (carrier || "").toLowerCase();
  if (c.includes("fedex"))
    return `https://www.fedex.com/fedextrack/?tracknumbers=${n}`;
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${n}`;
  if (c.includes("usps"))
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
  if (c.includes("dhl"))
    return `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${n}`;
  if (c.includes("ontrac"))
    return `https://www.ontrac.com/trackingres.asp?tracking_number=${n}`;
  return `https://www.google.com/search?q=${encodeURIComponent(
    num + " tracking"
  )}`;
}

function pkgForNumber(pkgs: any[], num: string) {
  if (!Array.isArray(pkgs)) return null;
  return pkgs.find((p) => {
    const v =
      p?.packageTrackingNumber ||
      p?.trackingNumber ||
      p?.packageTrackingNo ||
      "";
    return String(v).trim() === String(num).trim();
  });
}

function pkgTrackingUrl(pkg: any): string {
  const url =
    pkg?.packageTrackingUrl ||
    pkg?.trackingUrl ||
    pkg?.packageTrackingLink ||
    "";
  return url ? String(url) : "";
}

function collectTrackingStrings(obj: any): string[] {
  const out = new Set<string>();
  (function walk(o: any) {
    if (o && typeof o === "object") {
      for (const k in o) {
        const v = o[k];
        if (
          k.toLowerCase().includes("tracking") &&
          typeof v === "string" &&
          v.trim()
        ) {
          out.add(v.trim());
        } else if (typeof v === "object") {
          walk(v);
        }
      }
    }
  })(obj);
  return Array.from(out);
}

function dedupeDetails(
  arr: { number: string; carrier: string; url: string }[]
): { number: string; carrier: string; url: string }[] {
  const seen = new Set<string>();
  const out: typeof arr = [];
  for (const d of arr) {
    const key = `${d.number}::${d.carrier || "?"}::${d.url || "?"}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}
