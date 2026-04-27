import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

type UpdateResult = {
  error: { message: string } | null;
  data?: Array<{ id: number }>;
};

function makeSupabaseClient(options?: {
  autopayUpdate?: UpdateResult;
  invoiceUpdate?: { error: { message: string } | null };
}) {
  const autopayUpdate = options?.autopayUpdate ?? {
    error: null,
    data: [{ id: 1 }, { id: 2 }],
  };
  const invoiceUpdate = options?.invoiceUpdate ?? {
    error: null,
  };
  const calls: Array<{
    table: string;
    values: Record<string, unknown>;
    filter?: { column: string; value: unknown };
    selectedColumns?: string;
  }> = [];

  const client = {
    from(table: string) {
      return {
        update(values: Record<string, unknown>) {
          const entry = { table, values } as {
            table: string;
            values: Record<string, unknown>;
            filter?: { column: string; value: unknown };
            selectedColumns?: string;
          };
          calls.push(entry);
          return {
            eq(column: string, value: unknown) {
              entry.filter = { column, value };
              if (table === "autopayment_queue_stock_change") {
                return {
                  select(_columns: string) {
                    entry.selectedColumns = _columns;
                    return Promise.resolve(autopayUpdate);
                  },
                };
              }
              if (table === "invoices") {
                return Promise.resolve(invoiceUpdate);
              }

              throw new Error(`Unexpected table ${table}`);
            },
          };
        },
      };
    },
  };

  return { client, calls };
}

function sign(body: string, secret: string) {
  return (
    "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex")
  );
}

describe("record-payment-autopay-callback route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.NSWRITES_WEBHOOK_SECRET = "autopay-secret";
    delete process.env.PORTAL_CALLBACK_SECRET;
    delete process.env.CALLBACK_SKIP_VERIFY;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T12:00:01.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks the autopay queue rows paid when the callback succeeds", async () => {
    const { client, calls } = makeSupabaseClient();
    mockCreateClient.mockReturnValue(client);
    const { POST } = await import("./route");

    const payload = {
      job_id: "job-123",
      type: "record_payment",
      status: "done",
      result: { paymentId: 98765 },
      meta: { invoiceInternalId: 9001 },
    };
    const raw = JSON.stringify(payload);

    const req = new Request("http://localhost/api/callback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-job-signature": sign(raw, "autopay-secret"),
      },
      body: raw,
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      invoiceId: 9001,
      job: "job-123",
      status: "done",
      updatedRows: 2,
    });
    expect(calls).toEqual([
      {
        table: "autopayment_queue_stock_change",
        values: {
          status: "paid",
          callback_received_at: "2026-03-28T12:00:01.000Z",
          last_callback_status: "done",
          payment_id: "98765",
          last_error: null,
          callback_payload: payload,
        },
        filter: { column: "netsuite_job_id", value: "job-123" },
        selectedColumns: "id",
      },
      {
        table: "invoices",
        values: {
          payment_processing: false,
          payment_processing_started_at: null,
        },
        filter: { column: "invoice_id", value: 9001 },
      },
    ]);
  });

  it("marks the queue rows failed when the callback status is failed", async () => {
    const autopayUpdate = { error: null, data: [{ id: 1 }] };
    const { client, calls } = makeSupabaseClient({ autopayUpdate });
    mockCreateClient.mockReturnValue(client);
    const { POST } = await import("./route");

    const payload = {
      job_id: "job-failed",
      type: "record_payment",
      status: "failed",
      error: { message: "Processor rejected payment" },
      meta: { invoiceInternalId: 9002 },
    };
    const raw = JSON.stringify(payload);

    const req = new Request("http://localhost/api/callback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-job-signature": sign(raw, "autopay-secret"),
      },
      body: raw,
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      invoiceId: 9002,
      job: "job-failed",
      status: "failed",
      updatedRows: 1,
    });
    expect(calls[0]).toEqual({
      table: "autopayment_queue_stock_change",
      values: {
        status: "failed",
        callback_received_at: "2026-03-28T12:00:01.000Z",
        last_callback_status: "failed",
        last_error: JSON.stringify({ message: "Processor rejected payment" }),
        callback_payload: payload,
      },
      filter: { column: "netsuite_job_id", value: "job-failed" },
      selectedColumns: "id",
    });
    expect(calls[1]).toEqual({
      table: "invoices",
      values: {
        payment_processing: false,
        payment_processing_started_at: null,
      },
      filter: { column: "invoice_id", value: 9002 },
    });
  });

  it("returns 404 when no autopay queue rows match the callback job id", async () => {
    const { client } = makeSupabaseClient({
      autopayUpdate: { error: null, data: [] },
    });
    mockCreateClient.mockReturnValue(client);
    const { POST } = await import("./route");

    const payload = {
      job_id: "job-missing",
      type: "record_payment",
      status: "done",
      result: { paymentId: 777 },
      meta: { invoiceInternalId: 9003 },
    };
    const raw = JSON.stringify(payload);

    const req = new Request("http://localhost/api/callback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-job-signature": sign(raw, "autopay-secret"),
      },
      body: raw,
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({
      ok: false,
      error: "No autopay queue rows matched callback job_id",
      job: "job-missing",
    });
  });

  it("returns 401 when the callback signature is invalid", async () => {
    mockCreateClient.mockReturnValue(makeSupabaseClient().client);
    const { POST } = await import("./route");

    const raw = JSON.stringify({
      job_id: "job-401",
      type: "record_payment",
      status: "done",
      result: { paymentId: 123 },
      meta: { invoiceInternalId: 9004 },
    });

    const req = new Request("http://localhost/api/callback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-job-signature": "sha256=invalid",
      },
      body: raw,
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({ error: "bad signature" });
  });

  it("returns 500 when clearing the invoice processing flag fails", async () => {
    const { client } = makeSupabaseClient({
      invoiceUpdate: { error: { message: "invoice update failed" } },
    });
    mockCreateClient.mockReturnValue(client);
    const { POST } = await import("./route");

    const payload = {
      job_id: "job-invoice-fail",
      type: "record_payment",
      status: "done",
      result: { paymentId: 777 },
      meta: { invoiceInternalId: 9005 },
    };
    const raw = JSON.stringify(payload);

    const req = new Request("http://localhost/api/callback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-job-signature": sign(raw, "autopay-secret"),
      },
      body: raw,
    });

    const res = await POST(req as never);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({
      ok: false,
      error: "invoice update failed",
      job: "job-invoice-fail",
    });
  });
});
