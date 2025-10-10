import { NextRequest } from "next/server";
import axios from "axios";
import { getValidToken } from "../../../../lib/netsuite/token";

const NS_ENV = process.env.NETSUITE_ENV?.toLowerCase() || "prod";
const isSB = NS_ENV === "sb";
const NETSUITE_ACCOUNT_ID = isSB
  ? process.env.NETSUITE_ACCOUNT_ID_SB!
  : process.env.NETSUITE_ACCOUNT_ID!;
const BASE_URL = `https://${NETSUITE_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest`;

const NETSUITE_UI_HOST = (
  process.env.NETSUITE_UI_HOST || `${NETSUITE_ACCOUNT_ID}.app.netsuite.com`
)
  .replace(/^https?:\/\//, "")
  .trim();

const NS_UI_BASE = `https://${NETSUITE_UI_HOST}`;

const invoiceUrl = (id: number | string) =>
  `${NS_UI_BASE}/app/accounting/transactions/custinvc.nl?whence=&id=${id}`;
const depositUrl = (id: number | string) =>
  `${NS_UI_BASE}/app/accounting/transactions/custdep.nl?whence=&id=${id}`;
const salesOrderUrl = (id: number | string) =>
  `${NS_UI_BASE}/app/accounting/transactions/salesord.nl?whence=&id=${id}`;

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function GET(req: NextRequest) {
  const soIdParam = req.nextUrl.searchParams.get("internalId");
  const customerIdParam = req.nextUrl.searchParams.get("customerId");

  if (!soIdParam && !customerIdParam) {
    return new Response(
      JSON.stringify({ error: "Provide customerId or internalId" }),
      { status: 400 }
    );
  }

  try {
    const token = await getValidToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "transient",
    } as const;

    let customerId: number | null = null;
    let invoiceIds: number[] = [];

    if (customerIdParam) {
      customerId = Number(customerIdParam);
      if (!Number.isFinite(customerId)) {
        return new Response(JSON.stringify({ error: "Invalid customerId" }), {
          status: 400,
        });
      }
      const custInvQ = `
        SELECT T.id AS invoiceId
        FROM transaction T
        WHERE T.type = 'CustInvc' AND T.entity = ${customerId}
        ORDER BY T.trandate DESC
      `;
      const invResp = await axios.post(
        `${BASE_URL}/query/v1/suiteql`,
        { q: custInvQ },
        { headers }
      );
      invoiceIds =
        invResp?.data?.items
          ?.map((i: any) => Number(i.invoiceid))
          .filter(Number.isFinite) || [];
    } else {
      const soId = Number(soIdParam);
      if (!Number.isFinite(soId)) {
        return new Response(JSON.stringify({ error: "Invalid internalId" }), {
          status: 400,
        });
      }

      const invoiceQ = `
        SELECT T.id AS invoiceId
        FROM transaction T
        INNER JOIN PreviousTransactionLink PTL ON PTL.NextDoc = T.id
        WHERE T.type = 'CustInvc' AND PTL.PreviousDoc = ${soId}
      `;
      const soCustomerQ = `
        SELECT T.entity AS customerId
        FROM transaction T
        WHERE T.id = ${soId}
      `;

      const [invResp, soResp] = await Promise.all([
        axios.post(
          `${BASE_URL}/query/v1/suiteql`,
          { q: invoiceQ },
          { headers }
        ),
        axios.post(
          `${BASE_URL}/query/v1/suiteql`,
          { q: soCustomerQ },
          { headers }
        ),
      ]);

      customerId = (() => {
        const row = soResp?.data?.items?.[0] || {};
        const val = row.customerid ?? row.customerId;
        return val != null ? Number(val) : null;
      })();

      invoiceIds =
        invResp?.data?.items
          ?.map((i: any) => Number(i.invoiceid))
          .filter(Number.isFinite) || [];
    }

    let deposits: any[] = [];
    if (customerId) {
      const depositsQ = `
        SELECT
          T.id AS depositId,
          T.tranid AS tranId,
          T.trandate AS trandate,
          BUILTIN.DF(T.status) AS status,
          T.total AS total
        FROM transaction T
        WHERE T.type = 'CustDep'
          AND T.entity = ${customerId}
        ORDER BY T.trandate DESC
      `;
      const depResp = await axios.post(
        `${BASE_URL}/query/v1/suiteql`,
        { q: depositsQ },
        { headers }
      );
      const depItems = depResp?.data?.items || [];

      let linkMap = new Map<
        number,
        { soId: number; soTranId: string | null }
      >();
      const depositIds = depItems
        .map((d: any) => Number(d.depositid))
        .filter(Number.isFinite);
      if (depositIds.length) {
        const linkQ = `
          SELECT
            PTL.NextDoc AS depositId,
            PTL.PreviousDoc AS soId,
            BUILTIN.DF(PTL.PreviousDoc) AS soTranId
          FROM PreviousTransactionLink PTL
          WHERE PTL.NextDoc IN (${depositIds.join(",")})
        `;
        const linkResp = await axios.post(
          `${BASE_URL}/query/v1/suiteql`,
          { q: linkQ },
          { headers }
        );
        for (const r of linkResp?.data?.items || []) {
          const did = Number(r.depositid);
          const soId = Number(r.soid);
          const soTranId = r.sotranid || null;
          if (Number.isFinite(did) && Number.isFinite(soId))
            linkMap.set(did, { soId, soTranId });
        }
      }

      deposits = depItems.map((d: any) => {
        const depositId = Number(d.depositid);
        const statusStr = String(d.status || "");
        const isFullyApplied =
          /fully/i.test(statusStr) && /applied/i.test(statusStr);
        const isPartiallyApplied = /partially\s*applied/i.test(statusStr);
        const isUnapplied = !isFullyApplied;
        const link = linkMap.get(depositId) || null;
        const isAppliedToSO = !!link;
        const isUnappliedToSO = !isAppliedToSO;

        return {
          depositId,
          tranId: d.tranid,
          trandate: d.trandate,
          status: statusStr,
          total: Number(d.total ?? 0),
          appliedTo: link
            ? {
                soId: link.soId,
                soTranId: link.soTranId,
                netsuiteUrl: salesOrderUrl(link.soId),
              }
            : null,
          isFullyApplied,
          isPartiallyApplied,
          isAppliedToSO,
          isUnapplied,
          isUnappliedToSO,
          netsuiteUrl: depositUrl(depositId),
        };
      });
    }

    if (invoiceIds.length === 0) {
      return new Response(
        JSON.stringify({
          invoices: [],
          deposits,
          unappliedDeposits: [],
          customerId,
        }),
        { status: 200 }
      );
    }

    const invoices: any[] = [];
    const headerMap = new Map<number, any>();
    const linesByInvoice = new Map<number, any[]>();
    const paymentsByInvoice = new Map<number, any[]>();
    const soLinkByInvoice = new Map<
      number,
      { soId: number | null; soTranId: string | null }
    >();

    for (const batch of chunk(invoiceIds, 900)) {
      const idList = batch.join(",");

      const headersQ = `
        SELECT
          T.id AS invoiceId,
          T.tranid AS tranId,
          T.trandate AS trandate,
          T.total AS total,
          T.entity AS customerId
        FROM transaction T
        WHERE T.type = 'CustInvc' AND T.id IN (${idList})
      `;

      const linesQ = `
  SELECT
    TL.transaction AS invoiceId,
    I.id AS itemId,
    I.itemid AS sku,
    I.displayname AS displayName,
    NVL(ABS(TL.quantity), 0) AS quantity,
    TL.rate AS rate,
    NVL(ABS(TL.amount), 0) AS amount,
    TL.memo AS description
  FROM transactionline TL
  JOIN item I ON I.id = TL.item
  WHERE TL.transaction IN (${idList})
`;

      const paymentsQ = `
        SELECT
          TL.createdfrom AS invoiceId,
          P.id AS paymentId,
          P.tranid AS tranId,
          P.trandate AS paymentDate,
          BUILTIN.DF(P.status) AS status,
          P.total AS amount,
          BUILTIN.DF(P.paymentoption) AS paymentOption
        FROM transaction P
        JOIN transactionline TL
          ON TL.transaction = P.id
        WHERE P.type = 'CustPymt' AND TL.createdfrom IN (${idList})
      `;

      const soLinkQ = `
        SELECT
          PTL.NextDoc AS invoiceId,
          PTL.PreviousDoc AS soId,
          S.tranid AS soTranId
        FROM PreviousTransactionLink PTL
        JOIN transaction S ON S.id = PTL.PreviousDoc
        WHERE PTL.NextDoc IN (${idList}) AND S.type='SalesOrd'
      `;

      const [headersResp, linesResp, paymentsResp, soLinksResp] =
        await Promise.all([
          axios.post(
            `${BASE_URL}/query/v1/suiteql`,
            { q: headersQ },
            { headers }
          ),
          axios.post(
            `${BASE_URL}/query/v1/suiteql`,
            { q: linesQ },
            { headers }
          ),
          axios.post(
            `${BASE_URL}/query/v1/suiteql`,
            { q: paymentsQ },
            { headers }
          ),
          axios.post(
            `${BASE_URL}/query/v1/suiteql`,
            { q: soLinkQ },
            { headers }
          ),
        ]);

      for (const h of headersResp?.data?.items || []) {
        const id = Number(h.invoiceid);
        headerMap.set(id, {
          invoiceId: id,
          tranId: h.tranid,
          trandate: h.trandate,
          total: Number(h.total ?? 0),
          customerId:
            h.customerid != null ? Number(h.customerid) : customerId ?? null,
        });
      }

      for (const r of linesResp?.data?.items || []) {
        const invId = Number(r.invoiceid);
        if (!linesByInvoice.has(invId)) linesByInvoice.set(invId, []);
        const displayName =
          r.displayname != null ? String(r.displayname) : null;
        const line = {
          itemId: Number(r.itemid),
          itemName: r.sku != null ? String(r.sku) : null,
          itemDisplayName:
            displayName || (r.sku != null ? String(r.sku) : null),
          quantity: Number(r.quantity ?? 0),
          rate: Number(r.rate ?? 0),
          amount: Number(r.amount ?? 0),
          description: r.description ?? null,
        };
        console.log("Invoice line displayName", {
          invoiceId: invId,
          itemId: line.itemId ?? null,
          sku: line.itemName ?? null,
          displayName: line.itemDisplayName,
          fetchedFromItemRecord: true,
        });
        linesByInvoice.get(invId)!.push(line);
      }

      for (const p of paymentsResp?.data?.items || []) {
        const invId = Number(p.invoiceid);
        if (!paymentsByInvoice.has(invId)) paymentsByInvoice.set(invId, []);
        paymentsByInvoice.get(invId)!.push({
          paymentId: p.paymentid,
          tranId: p.tranid,
          paymentDate: p.paymentdate,
          amount: Number(p.amount ?? 0),
          status: p.status,
          paymentOption: p.paymentoption,
        });
      }

      for (const s of soLinksResp?.data?.items || []) {
        const invId = Number(s.invoiceid);
        const soId = Number(s.soid);
        const soTranId = s.sotranid != null ? String(s.sotranid) : null;
        soLinkByInvoice.set(invId, {
          soId: Number.isFinite(soId) ? soId : null,
          soTranId,
        });
        console.log("Invoice → SO tran number", invId, soTranId || "(none)");
      }
    }

    const invoicesOut: any[] = [];
    for (const id of invoiceIds) {
      const head = headerMap.get(id);
      const so = soLinkByInvoice.get(id) || { soId: null, soTranId: null };
      const payments = paymentsByInvoice.get(id) || [];
      console.log(payments);
      const amountPaid = payments.reduce(
        (s, p) => s + (Number(p.amount) || 0),
        0
      );
      const total = Number(head?.total ?? 0);
      const amountRemaining = Math.max(0, total - amountPaid);

      invoicesOut.push({
        invoiceId: id,
        tranId: head?.tranId ?? null,
        trandate: head?.trandate ?? null,
        total,
        amountPaid,
        amountRemaining,
        customerId: head?.customerId ?? customerId ?? null,
        createdFromSoId: so.soId,
        createdFromSoTranId: so.soTranId,
        createdFromSoUrl: so.soId ? salesOrderUrl(so.soId) : null,
        lines: linesByInvoice.get(id) || [],
        payments,
        netsuiteUrl: invoiceUrl(id),
      });
    }

    const unappliedDeposits = deposits.filter((d) => d.isUnappliedToSO);

    return new Response(
      JSON.stringify({
        invoices: invoicesOut,
        deposits,
        unappliedDeposits,
        customerId,
      }),
      { status: 200 }
    );
  } catch (err: any) {
    console.error(
      " Failed to fetch invoices/deposits:",
      err?.response?.data || err?.message
    );
    return new Response(
      JSON.stringify({ error: "Could not load invoices/deposits" }),
      { status: 500 }
    );
  }
}
