import { ServerClient } from 'postmark';

const POSTMARK_SERVER_TOKEN = process.env.POSTMARK_SERVER_TOKEN;
const POSTMARK_FROM_EMAIL = process.env.POSTMARK_FROM_EMAIL!

if (!POSTMARK_SERVER_TOKEN || !POSTMARK_FROM_EMAIL) {
  throw new Error('POSTMARK_SERVER_TOKEN and POSTMARK_FROM_EMAIL environment variables are required');
}

const client = new ServerClient(POSTMARK_SERVER_TOKEN);

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: EmailOptions) {
  try {
    const result = await client.sendEmail({
      From: POSTMARK_FROM_EMAIL,
      To: options.to,
      Subject: options.subject,
      HtmlBody: options.html,
      TextBody: options.text,
    });

    return result;
  } catch (error) {
    console.error('Failed to send email:', error);
    throw error;
  }
}

export { client };
