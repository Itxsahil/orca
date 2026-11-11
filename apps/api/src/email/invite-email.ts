import type { EmailMessage } from './send';

/*
 * Invite email, styled like the web app (shadcn "neutral" theme, Geist, 0.625rem radius).
 * Email clients don't support oklch() or CSS variables, so the theme colours are written
 * out as hex. Light by default; switches to the app's dark palette in clients that
 * support prefers-color-scheme (Apple Mail, iOS, Outlook.com, ...).
 */

const APP_NAME = 'Video Platform';

// apps/web/src/styles.css → hex
const LIGHT = {
  page: '#f5f5f5', // --muted          oklch(0.97 0 0)
  card: '#ffffff', // --card           oklch(1 0 0)
  text: '#0a0a0a', // --foreground     oklch(0.145 0 0)
  muted: '#737373', // --muted-foreground oklch(0.556 0 0)
  border: '#e5e5e5', // --border        oklch(0.922 0 0)
  primary: '#171717', // --primary      oklch(0.205 0 0)
  primaryText: '#fafafa', // --primary-foreground oklch(0.985 0 0)
};
const DARK = {
  page: '#0a0a0a', // --background     oklch(0.145 0 0)
  card: '#171717', // --card           oklch(0.205 0 0)
  text: '#fafafa', // --foreground     oklch(0.985 0 0)
  muted: '#a1a1a1', // --muted-foreground oklch(0.708 0 0)
  border: '#2e2e2e', // --border        oklch(1 0 0 / 10%) over the card
  primary: '#e5e5e5', // --primary      oklch(0.922 0 0)
  primaryText: '#171717', // --primary-foreground oklch(0.205 0 0)
};
const FONT =
  "'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface InviteEmailInput {
  to: string;
  orgName: string;
  inviterName: string;
  inviteUrl: string;
  expiresAt: Date;
}

export function renderInviteEmail(input: InviteEmailInput): EmailMessage {
  const expires = input.expiresAt.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const subject = `You're invited to set up ${input.orgName} on ${APP_NAME}`;

  const org = escapeHtml(input.orgName);
  const inviter = escapeHtml(input.inviterName);
  const url = escapeHtml(input.inviteUrl);
  const L = LIGHT;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
  a { text-decoration: none; }
  @media (prefers-color-scheme: dark) {
    .page { background: ${DARK.page} !important; }
    .card { background: ${DARK.card} !important; border-color: ${DARK.border} !important; }
    .text { color: ${DARK.text} !important; }
    .muted { color: ${DARK.muted} !important; }
    .rule { border-color: ${DARK.border} !important; }
    .btn { background: ${DARK.primary} !important; }
    .btn a { color: ${DARK.primaryText} !important; }
    .link { color: ${DARK.text} !important; }
  }
  @media (max-width: 520px) { .card-pad { padding: 24px !important; } }
</style>
</head>
<body class="page" style="margin:0;padding:0;background:${L.page};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${inviter} invited you to set up ${org}. The link expires on ${expires}.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="page" style="background:${L.page};">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
          <tr>
            <td class="text" style="padding:0 4px 16px;font-family:${FONT};font-size:14px;font-weight:600;color:${L.text};">${APP_NAME}</td>
          </tr>
          <tr>
            <td class="card card-pad" style="background:${L.card};border:1px solid ${L.border};border-radius:14px;padding:32px;">
              <h1 class="text" style="margin:0 0 8px;font-family:${FONT};font-size:20px;line-height:28px;font-weight:600;color:${L.text};">Join ${org}</h1>
              <p class="muted" style="margin:0 0 24px;font-family:${FONT};font-size:14px;line-height:22px;color:${L.muted};">${inviter} invited you to set up <strong class="text" style="color:${L.text};font-weight:500;">${org}</strong> on ${APP_NAME} as its owner. Choose a name and password to get started.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="btn" style="background:${L.primary};border-radius:10px;">
                    <a href="${url}" style="display:inline-block;padding:10px 18px;font-family:${FONT};font-size:14px;font-weight:500;line-height:20px;color:${L.primaryText};text-decoration:none;">Accept invite</a>
                  </td>
                </tr>
              </table>
              <p class="muted" style="margin:24px 0 6px;font-family:${FONT};font-size:12px;line-height:18px;color:${L.muted};">Or paste this link into your browser:</p>
              <p style="margin:0;font-family:${MONO};font-size:12px;line-height:18px;word-break:break-all;"><a class="link" href="${url}" style="color:${L.text};text-decoration:underline;">${url}</a></p>
              <hr class="rule" style="margin:24px 0;border:0;border-top:1px solid ${L.border};">
              <p class="muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${L.muted};">This link works once and expires on ${expires}.</p>
            </td>
          </tr>
          <tr>
            <td class="muted" style="padding:16px 4px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${L.muted};">If you weren't expecting this invite, you can ignore this email.</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `Join ${input.orgName}`,
    '',
    `${input.inviterName} invited you to set up ${input.orgName} on ${APP_NAME} as its owner.`,
    'Choose a name and password to get started:',
    '',
    input.inviteUrl,
    '',
    `This link works once and expires on ${expires}.`,
    "If you weren't expecting this invite, you can ignore this email.",
  ].join('\n');

  return { to: input.to, subject, html, text };
}
