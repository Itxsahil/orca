import { env } from '../env';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type SendResult = { sent: true; id: string } | { sent: false; error: string };

/**
 * Sends an email through Resend's HTTP API (no SDK needed).
 * Never throws: callers decide what a failed email means for them.
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  if (!env.RESEND_API_KEY) {
    return { sent: false, error: 'Email is not set up (RESEND_API_KEY is empty).' };
  }

  try {
    const res = await fetch(`${env.RESEND_API_URL}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, ...message }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !body.id) {
      const error = body.message ?? `Resend answered ${res.status}`;
      console.error(`[email] sending to ${message.to} failed: ${error}`);
      return { sent: false, error };
    }
    return { sent: true, id: body.id };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[email] sending to ${message.to} failed: ${error}`);
    return { sent: false, error: `Could not reach the email service (${error}).` };
  }
}
