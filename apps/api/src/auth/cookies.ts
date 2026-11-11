import { env } from '../env';

/**
 * In production the cookie uses the __Host- prefix: browsers then only accept it
 * when it is Secure, has Path=/ and no Domain, so a subdomain cannot overwrite it.
 */
export const SESSION_COOKIE = env.COOKIE_SECURE ? '__Host-session' : 'session';

export function readCookie(headers: Headers | undefined, name: string): string | undefined {
  const header = headers?.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function serializeSessionCookie(value: string, maxAgeSeconds: number): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    ...(env.COOKIE_SECURE ? ['Secure'] : []),
  ].join('; ');
}

export function clearSessionCookie(): string {
  return serializeSessionCookie('', 0);
}
