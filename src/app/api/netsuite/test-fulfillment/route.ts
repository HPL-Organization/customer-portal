import { NextRequest } from "next/server";
import axios from "axios";
import { getValidToken } from "@/lib/netsuite/token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;
const ADMIN_SYNC_SECRET = process.env.ADMIN_SYNC_SECRET!;
const ADMIN_SECRET_HEADER = "x-admin-secret";

const http = axios.create({ timeout: 60000 });

function bool(x: any): boolean {
  return !!x;
}
function getArray(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x == null) return [];
  return [x];
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

export async function GET(req: NextRequest) {
  try {
    if (
      !ADMIN_SYNC_SECRET ||
      req.headers.get(ADMIN_SECRET_HEADER) !== ADMIN_SYNC_SECRET
    ) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const idStr = req.nextUrl.searchParams.get("id");
    if (!idStr || !/^\d+$/.test(idStr)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            "Missing or invalid ?id= (must be numeric NetSuite internal ID)",
        }),
        { status: 400 }
      );
    }
    const id = Number(idStr);

    const token = await getValidToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      Prefer: "transient",
      "Content-Type": "application/json",
    } as const;

    const recResp = await http.get(
      `${BASE_URL}/record/v1/itemFulfillment/${id}?expandSubResources=true`,
      { headers }
    );
    const rec = recResp.data || {};

    const qHeaders = `
      SELECT
        T.id AS fulfillmentId,
        T.tranid AS tranId,
        T.trandate AS trandate,
        T.entity AS customerId,
        BUILTIN.DF(T.status) AS status,
        TO_CHAR(T.lastmodifieddate,'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM') AS lastmodifieddate
      FROM transaction T
      WHERE T.type='ItemShip' AND T.id=${id}
    `;
    const qSoLink = `
      SELECT
        PTL.NextDoc AS fulfillmentId,
        PTL.PreviousDoc AS soId,
        S.tranid AS soTranId
      FROM PreviousTransactionLink PTL
      JOIN transaction S ON S.id = PTL.PreviousDoc
      WHERE PTL.NextDoc = ${id} AND S.type='SalesOrd'
    `;
    const [h, s] = await Promise.all([
      http.post(`${BASE_URL}/query/v1/suiteql`, { q: qHeaders }, { headers }),
      http.post(`${BASE_URL}/query/v1/suiteql`, { q: qSoLink }, { headers }),
    ]);
    const headerRow = (h?.data?.items || [])[0] || {};
    const soRow = (s?.data?.items || [])[0] || {};

    const packagesRaw =
      rec?.packageList?.packages ?? rec?.packageList ?? rec?.packages ?? [];
    const pkgs = getArray(packagesRaw);
    const numbers: string[] = [];
    for (const pkg of pkgs) {
      const num =
        pkg?.packageTrackingNumber ||
        pkg?.trackingNumber ||
        pkg?.packageTrackingNo ||
        "";
      if (num) numbers.push(String(num));
    }
    if (!numbers.length) {
      const out = new Set<string>();
      (function walk(o: any) {
        if (o && typeof o === "object") {
          for (const k in o) {
            const v = o[k];
            if (
              k.toLowerCase().includes("tracking") &&
              typeof v === "string" &&
              v.trim()
            )
              out.add(v.trim());
            else if (typeof v === "object") walk(v);
          }
        }
      })(rec);
      numbers.push(...Array.from(out));
    }
    const tracking_details = numbers.map((num) => {
      const carrier = inferCarrierFromNumber(num);
      return { number: num, carrier, url: buildTrackingUrl(carrier, num) };
    });

    const firstPath =
      (Array.isArray(rec?.item?.items) && rec.item.items) ||
      (Array.isArray(rec?.itemList?.items) && rec.itemList.items) ||
      (Array.isArray(rec?.item) && rec.item) ||
      [];
    const rows: any[] = Array.isArray(firstPath) ? firstPath : [];

    const raw_identity_preview = rows.map((row, idx) => ({
      idx,
      line: row?.line ?? null,
      lineId: null,
      lineUniqueKey: null,
      orderline: null,
      kitlineid: null,
      id: null,
    }));

    const parsed_lines = rows.map((row) => {
      const lineStr = row?.line != null ? String(row.line) : null;
      const lineNum = lineStr != null ? Number(lineStr) : null;

      const itemObj = row?.item ?? row?.itemRef ?? {};
      const itemId = Number(itemObj?.id ?? itemObj?.internalId ?? NaN);

      const skuCandidate =
        itemObj?.refName ??
        itemObj?.name ??
        itemObj?.text ??
        row?.itemid ??
        null;
      const itemSku = skuCandidate != null ? String(skuCandidate) : null;

      const disp =
        row?.description ?? itemObj?.displayName ?? itemObj?.refName ?? null;

      const qty = Math.abs(Number(row?.quantity ?? 0)) || 0;

      const serials: string[] = [];
      const ia =
        row?.inventoryassignment ||
        row?.inventoryAssignment ||
        row?.inventoryDetail ||
        null;
      if (ia && typeof ia === "object") {
        const assignments =
          ia?.assignments || ia?.assignment || ia?.details || [];
        const arr = Array.isArray(assignments) ? assignments : [assignments];
        for (const a of arr) {
          const sn =
            a?.issueinventorynumber?.text ??
            a?.inventorynumber?.text ??
            a?.serialnumber ??
            a?.lotnumber ??
            null;
          if (sn) serials.push(String(sn));
        }
      }
      const commentVal = row?.custcol_hpl_comment ?? row?.comments ?? null;
      const comments = commentVal != null ? [String(commentVal)] : null;

      return {
        line_id: lineNum,
        line_key: lineStr,
        line_no: lineNum,
        item_id: Number.isFinite(itemId) ? itemId : null,
        item_sku: itemSku,
        item_display_name: disp != null ? String(disp) : null,
        quantity: qty,
        serial_numbers: serials.length ? Array.from(new Set(serials)) : null,
        comments,
      };
    });

    const shipStatus =
      rec?.shipStatus?.refName ||
      rec?.shipstatus?.refName ||
      rec?.shipStatus?.text ||
      rec?.shipstatus?.text ||
      "";

    const body = {
      ok: true,
      fulfillment_id: idStr,
      header: {
        fulfillmentid: headerRow?.fulfillmentid ?? String(id),
        tranid: headerRow?.tranid ?? null,
        trandate: headerRow?.trandate ?? null,
        customerid: headerRow?.customerid ?? null,
        status: headerRow?.status ?? null,
        lastmodifieddate: headerRow?.lastmodifieddate ?? null,
      },
      so_link: {
        fulfillmentid: soRow?.fulfillmentid ?? String(id),
        soid: soRow?.soid ?? null,
        sotranid: soRow?.sotranid ?? null,
      },
      ship_status: shipStatus || null,
      tracking_details,
      raw_paths_present: {
        "item.items": bool(rec?.item?.items),
        "itemList.items": bool(rec?.itemList?.items),
        item: Array.isArray(rec?.item),
      },
      counts: {
        raw_item_items: Array.isArray(rec?.item?.items)
          ? rec.item.items.length
          : 0,
        raw_itemList_items: Array.isArray(rec?.itemList?.items)
          ? rec.itemList.items.length
          : 0,
        raw_item: Array.isArray(rec?.item) ? rec.item.length : 0,
        parsed_lines: parsed_lines.length,
      },
      raw_identity_preview,
      parsed_lines,
    };

    return new Response(JSON.stringify(body, null, 2), { status: 200 });
  } catch (err: any) {
    const status = err?.response?.status || 500;
    const detail =
      typeof err?.response?.data === "string"
        ? err.response.data
        : err?.response?.data || String(err?.message || err);
    return new Response(
      JSON.stringify({ ok: false, error: "Failed", status, detail }, null, 2),
      { status }
    );
  }
}
