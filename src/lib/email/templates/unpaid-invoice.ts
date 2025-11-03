import { sendEmail } from '../postmark';

export interface CustomerInfo {
  firstName: string;
  email: string;
}

export interface InvoiceInfo {
  invoiceId: string;
  total: number;
  amountRemaining: number;
}

export async function sendUnpaidInvoiceNotification(
  customer: CustomerInfo,
  invoice: InvoiceInfo
) {
  const subject = 'Your Invoice from Highland Park Lapidary';

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your Invoice from Highland Park Lapidary</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
        }
        .content {
          margin-bottom: 30px;
        }
        .portal-link {
          display: inline-block;
          background-color: #007bff;
          color: white;
          padding: 12px 24px;
          text-decoration: none;
          border-radius: 4px;
          margin: 20px 0;
        }
        .footer {
          border-top: 1px solid #eee;
          padding-top: 20px;
          text-align: center;
          color: #666;
          font-size: 14px;
        }
        .phone {
          color: #007bff;
          text-decoration: none;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Highland Park Lapidary</h1>
      </div>

      <div class="content">
        <p>Dear ${customer.firstName},</p>

        <p>Thank you for your recent order with Highland Park Lapidary!</p>

        <p>You can view and pay your invoice securely through our customer portal:</p>

        <p style="text-align: center;">
          <a href="https://portal.hplapidary.com/" class="portal-link">
            Access Your Invoice Portal
          </a>
        </p>

        <p>We appreciate your business and look forward to serving you again.</p>

        <p>Warm regards,<br>
        The Highland Park Lapidary Team<br>
        📞 <a href="tel:512-348-8528" class="phone">512-348-8528</a></p>
      </div>

      <div class="footer">
        <p>This is an automated message. Please do not reply to this email.</p>
      </div>
    </body>
    </html>
  `;

  const textBody = `
Dear ${customer.firstName},

Thank you for your recent order with Highland Park Lapidary!

You can view and pay your invoice securely through our customer portal:

https://portal.hplapidary.com/

We appreciate your business and look forward to serving you again.

Warm regards,
The Highland Park Lapidary Team
📞 512-348-8528
  `.trim();

  return await sendEmail({
    to: customer.email,
    subject,
    html: htmlBody,
    text: textBody,
  });
}
