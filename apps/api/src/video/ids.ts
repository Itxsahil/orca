import { randomBytes } from 'node:crypto';

/** 32 hex characters, the same shape as a Cloudflare Stream video uid. */
export const newVideoUid = () => randomBytes(16).toString('hex');

export const isVideoUid = (value: string) => /^[0-9a-f]{32}$/.test(value);
