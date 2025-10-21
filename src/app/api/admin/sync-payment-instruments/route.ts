"use server";

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import { getValidToken } from "@/lib/netsuite/token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const RESTLET_URL =
  process.env.NETSUITE_PI_RESTLET_URL ||
  `https://${NETSUITE_ACCOUNT_ID}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=2438&deploy=1`;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_SYNC_SECRET = process.env.ADMIN_SYNC_SECRET!;
const ADMIN_SECRET_HEADER = "x-admin-secret";

const http = axios.create({ timeout: 60000 });

type Instrument = {
  id: string;
  paymentMethod: string | null;
  brand: string | null;
  last4: string | null;
  expiry: string | null;
  token: string | null;
  tokenFamily: string | null;
  tokenNamespace: string | null;
  isDefault?: boolean;
  loadError?: string;
  raw?: any;
};

type NSResponse = {
  success: boolean;
  instruments?: Instrument[];
  defaultInstrumentId?: string | null;
  truncated?: boolean;
  message?: string;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function netsuiteQuery(
  q: string,
  headers: Record<string, string>,
  tag?: string
) {
  let attempt = 0;
  const delays = [500, 1000, 2000, 4000, 8000];
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
      if (status === 429 || code === "CONCURRENCY_LIMIT_EXCEEDED") {
        const d = delays[Math.min(attempt, delays.length - 1)];
        await new Promise((r) => setTimeout(r, d));
        attempt++;
        continue;
      }
      const e = new Error("SuiteQL " + (tag || ""));
      (e as any).details = {
        tag,
        status: err?.response?.status,
        code,
        details:
          err?.response?.data?.["o:errorDetails"]?.[0]?.detail ||
          err?.response?.data,
        q,
      };
      throw e;
    }
  }
}

async function getAllNsCustomerIds(
  headers: Record<string, string>,
  includeInactive = true,
  pageSize = 1000
): Promise<number[]> {
  const out: number[] = [];
  let lastId: number | null = null;
  for (;;) {
    const conds: string[] = [];
    if (!includeInactive) conds.push(`c.isinactive = 'F'`);
    if (lastId != null) conds.push(`c.id < ${lastId}`);
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const q = `
      SELECT c.id AS id
      FROM customer c
      ${where}
      ORDER BY c.id DESC
      FETCH NEXT ${pageSize} ROWS ONLY
    `;
    const r = await netsuiteQuery(q, headers, "allCustomers");
    const items = r?.data?.items || [];
    for (const row of items) {
      const id = Number(row.id);
      if (Number.isFinite(id)) out.push(id);
    }
    if (items.length < pageSize) break;
    lastId = Number(items[items.length - 1].id);
    await new Promise((res) => setTimeout(res, 60));
  }
  return out;
}

async function fetchInstrumentsForCustomer(customerId: number, token: string) {
  let attempt = 0;
  const delays = [0, 500, 1000, 2000, 4000, 8000];
  for (;;) {
    try {
      const r = await http.post(
        RESTLET_URL,
        { customerId, includeTokens: true, includeDefault: true },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      const data: NSResponse = r.data || {};
      if (data.success === false) {
        throw new Error(data.message || "NetSuite error");
      }
      const defaultId =
        data.defaultInstrumentId != null
          ? String(data.defaultInstrumentId)
          : null;
      const instruments = (data.instruments || []).map((i) => {
        const isDefault =
          typeof i.isDefault === "boolean"
            ? i.isDefault
            : defaultId && String(i.id) === defaultId
            ? true
            : false;
        return { ...i, isDefault };
      });
      return instruments;
    } catch (e: any) {
      const status = e?.response?.status;
      const code = e?.response?.data?.["o:errorDetails"]?.[0]?.["o:errorCode"];
      if (
        status === 429 ||
        code === "CONCURRENCY_LIMIT_EXCEEDED" ||
        (status >= 500 && status < 600)
      ) {
        const d = delays[Math.min(attempt, delays.length - 1)];
        await new Promise((r) => setTimeout(r, d));
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

export async function POST(req: NextRequest) {
  if (
    !ADMIN_SYNC_SECRET ||
    req.headers.get(ADMIN_SECRET_HEADER) !== ADMIN_SYNC_SECRET
  ) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const idsParam = req.nextUrl.searchParams.get("ids");
  const forceAll = req.nextUrl.searchParams.get("forceAll") === "1";
  const batchSize = Math.max(
    50,
    Math.min(500, Number(req.nextUrl.searchParams.get("batchSize") ?? 300))
  );
  const detailConcurrency = Math.max(
    1,
    Math.min(10, Number(req.nextUrl.searchParams.get("detailConcurrency") ?? 5))
  );

  let customerIds: number[] = [];
  if (idsParam) {
    customerIds = idsParam
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  } else if (forceAll) {
    const token = await getValidToken();
    const headersQ = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "transient, maxpagesize=1000",
    } as Record<string, string>;
    customerIds = await getAllNsCustomerIds(headersQ, true);
  } else {
    const { data: profileRows, error: profilesErr } = await supabase
      .from("profiles")
      .select("netsuite_customer_id");
    if (profilesErr) {
      return new Response(
        JSON.stringify({ error: "Failed to load profiles" }),
        { status: 500 }
      );
    }
    customerIds = Array.from(
      new Set(
        (profileRows || [])
          .map((r: any) => Number(r.netsuite_customer_id))
          .filter(Number.isFinite)
      )
    );
  }

  if (!customerIds.length) {
    return new Response(
      JSON.stringify({
        scanned: 0,
        upserted: 0,
        checked: 0,
        softDeleted: 0,
        forceAll,
      }),
      { status: 200 }
    );
  }

  const token = await getValidToken();

  let upserted = 0;
  let checked = 0;
  let softDeleted = 0;

  for (const group of chunk(customerIds, batchSize)) {
    const batches = chunk(group, detailConcurrency);
    for (const g of batches) {
      const results = await Promise.allSettled(
        g.map((cid) => fetchInstrumentsForCustomer(cid, token))
      );

      for (let i = 0; i < g.length; i++) {
        const cid = g[i];
        const res = results[i];
        if (res.status !== "fulfilled") {
          continue;
        }

        const instruments = res.value || [];
        checked += instruments.length;

        const nowIso = new Date().toISOString();

        const rows = instruments.map((i: Instrument) => ({
          customer_id: cid,
          instrument_id: String(i.id),
          payment_method: i.paymentMethod ?? null,
          brand: i.brand ?? null,
          last4: i.last4 ?? null,
          expiry: i.expiry ?? null,
          token: i.token ?? null,
          token_family: i.tokenFamily ?? null,
          token_namespace: i.tokenNamespace ?? null,
          is_default: !!i.isDefault,
          ns_deleted_at: null,
          last_seen_at: nowIso,
          synced_at: nowIso,
          raw: i.raw ?? null,
        }));

        if (!dry && rows.length) {
          const { error: upErr } = await supabase
            .from("payment_instruments")
            .upsert(rows, {
              onConflict: "customer_id,instrument_id",
            });
          if (upErr) throw upErr;
          upserted += rows.length;
        }

        const { data: existing, error: exErr } = await supabase
          .from("payment_instruments")
          .select("instrument_id")
          .eq("customer_id", cid)
          .is("ns_deleted_at", null);
        if (exErr) throw exErr;

        const existingIds = new Set<string>(
          (existing || []).map((r: any) => String(r.instrument_id))
        );
        const currentIds = new Set<string>(
          instruments.map((i: Instrument) => String(i.id))
        );

        const missing: string[] = [];
        for (const id of existingIds) {
          if (!currentIds.has(id)) missing.push(id);
        }

        if (!dry && missing.length) {
          const { error: delErr } = await supabase
            .from("payment_instruments")
            .update({ ns_deleted_at: nowIso, synced_at: nowIso })
            .eq("customer_id", cid)
            .in("instrument_id", missing);
          if (delErr) throw delErr;
          softDeleted += missing.length;
        }
      }
    }
  }

  return new Response(
    JSON.stringify({
      scanned: customerIds.length,
      upserted,
      checked,
      softDeleted,
      forceAll,
    }),
    { status: 200 }
  );
}
