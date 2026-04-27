import { renderAutopayPendingChargeNotification } from "@/lib/email/templates/autopay-pending-charge";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
  fallback: string,
) {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

export default async function AutopayPendingChargePreviewPage({
  searchParams,
}: PageProps) {
  const params = (await searchParams) ?? {};
  const firstName = getParam(params, "firstName", "Raktim");
  const invoiceTranIdRaw = getParam(params, "invoiceTranId", "INV-18245");
  const soTranIdRaw = getParam(params, "soTranId", "SO-992721");
  const invoiceIdRaw = getParam(params, "invoiceId", "992722");
  const amountRaw = getParam(params, "amount", "0.01");
  const chargeAfterIso = getParam(
    params,
    "chargeAfterIso",
    "2026-03-28T16:00:00.000Z",
  );

  const invoiceId = Number(invoiceIdRaw);
  const amount = Number(amountRaw);

  const email = renderAutopayPendingChargeNotification({
    to: "preview@example.com",
    firstName,
    invoiceTranId: invoiceTranIdRaw || null,
    soTranId: soTranIdRaw || null,
    invoiceId: Number.isFinite(invoiceId) ? invoiceId : null,
    amount: Number.isFinite(amount) ? amount : 0,
    chargeAfterIso,
  });

  return (
    <main style={{ padding: 24, background: "#f5f5f5", minHeight: "100vh" }}>
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          display: "grid",
          gap: 24,
        }}
      >
        <section
          style={{
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: 20,
          }}
        >
          <h1 style={{ marginTop: 0 }}>Autopay Email Preview</h1>
          <p style={{ marginBottom: 8 }}>
            <strong>Subject:</strong> {email.subject}
          </p>
          <p style={{ margin: 0 }}>
            Preview variants with query params:
            <br />
            <code>
              /test/email/autopay-pending-charge?firstName=Alex&invoiceTranId=INV-20001&soTranId=SO-10001&amount=125.50
            </code>
          </p>
        </section>

        <section
          style={{
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid #ddd",
              background: "#fafafa",
              fontWeight: 600,
            }}
          >
            HTML Preview
          </div>
          <div dangerouslySetInnerHTML={{ __html: email.html }} />
        </section>

        <section
          style={{
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: 20,
          }}
        >
          <h2 style={{ marginTop: 0 }}>Text Version</h2>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            {email.text}
          </pre>
        </section>
      </div>
    </main>
  );
}
