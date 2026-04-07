import { sendEmail } from "../postmark";

export type AutopayPendingChargeParams = {
  to: string;
  firstName: string;
  invoiceTranId: string | null;
  soTranId?: string | null;
  invoiceId?: number | null;
  amount: number;
  chargeAfterIso: string;
};

export function renderAutopayPendingChargeNotification(
  params: AutopayPendingChargeParams,
) {
  const subject = "Upcoming automatic payment for your invoice";
  const chargeDate = new Date(params.chargeAfterIso).toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const invoiceLabel = params.invoiceTranId
    ? `invoice ${params.invoiceTranId}`
    : params.invoiceId
      ? `invoice #${params.invoiceId}`
      : "your invoice";
  const salesOrderLabel = params.soTranId ? ` for sales order ${params.soTranId}` : "";

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Upcoming automatic payment for your invoice</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header { text-align: center; margin-bottom: 30px; }
        .content { margin-bottom: 30px; }
        .portal-link {
          display: inline-block;
          background-color: #ED1C24;
          color: #ffffff !important;
          font-weight: 700;
          padding: 12px 24px;
          text-decoration: none !important;
          border-radius: 4px;
          margin: 20px 0;
        }
        .portal-link:visited { color: #ffffff !important; }
        a[x-apple-data-detectors] {
          color: inherit !important;
          text-decoration: none !important;
          font-size: inherit !important;
          font-family: inherit !important;
          font-weight: inherit !important;
          line-height: inherit !important;
        }
        .footer {
          border-top: 1px solid #eee;
          padding-top: 20px;
          text-align: center;
          color: #666;
          font-size: 14px;
        }
        .phone { color: #007bff; text-decoration: none; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Highland Park Lapidary</h1>
      </div>

      <div class="content">
        <p>Dear ${params.firstName},</p>

        <p>
          This is a reminder that we will automatically charge
          <strong>$${params.amount.toFixed(2)}</strong> for ${invoiceLabel}${salesOrderLabel}
          after <strong>${chargeDate}</strong>.
        </p>

        <p>
          If you need to review your payment method before the charge is processed,
          you can do so in the customer portal.
        </p>

        <p style="text-align: center;">
          <a
            href="https://portal.hplapidary.com/"
            class="portal-link"
            style="background-color:#ED1C24; color:#ffffff !important; font-weight:700; text-decoration:none !important; display:inline-block; padding:12px 24px; border-radius:4px;"
          >
            <span style="color:#ffffff !important; font-weight:700; text-decoration:none !important;">Access Portal</span>
          </a>
        </p>

        <p>We appreciate your business and look forward to serving you again.</p>

        <p>Warm regards,<br>
        The Highland Park Lapidary Team<br>
        <a href="tel:512-348-8528" class="phone">512-348-8528</a></p>
      </div>

      <div class="footer">
        <p>This is an automated message. Please do not reply to this email.</p>
      </div>
    </body>
    </html>
  `;

  const text = [
    `Dear ${params.firstName},`,
    "",
    `This is a reminder that we will automatically charge $${params.amount.toFixed(2)} for ${invoiceLabel}${salesOrderLabel} after ${chargeDate}.`,
    "",
    "If you need to review your payment method before the charge is processed, you can do so in the customer portal.",
    "https://portal.hplapidary.com/",
    "",
    "We appreciate your business and look forward to serving you again.",
    "",
    "Warm regards,",
    "The Highland Park Lapidary Team",
    "512-348-8528",
  ].join("\n");

  return { subject, html, text };
}

export async function sendAutopayPendingChargeNotification(
  params: AutopayPendingChargeParams,
) {
  const { subject, html, text } = renderAutopayPendingChargeNotification(params);

  return sendEmail({
    to: params.to,
    subject,
    html,
    text,
  });
}
