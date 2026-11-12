import type { NewVideoInput } from './upload-core';

/**
 * Parses a tus Upload-Metadata header: "key base64value,flagkey,key2 base64value".
 * Returns decoded values; keys without a value map to "".
 */
export function parseUploadMetadata(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(',')) {
    const [key, value] = pair.trim().split(/\s+/, 2);
    if (!key) continue;
    out[key] = value ? Buffer.from(value, 'base64').toString('utf8') : '';
  }
  return out;
}

/**
 * Maps Stream's supported Upload-Metadata keys onto video settings. Any other key
 * becomes a `meta` value, as on Stream (tus clients typically send filename/filetype).
 */
export function metadataToVideoInput(metadata: Record<string, string>) {
  const input: Partial<NewVideoInput> & { meta: Record<string, unknown> } = { meta: {} };
  for (const [rawKey, value] of Object.entries(metadata)) {
    const key = rawKey.toLowerCase();
    switch (key) {
      case 'name':
        input.meta.name = value;
        break;
      case 'requiresignedurls':
        input.requireSignedUrls = value === '' || value.toLowerCase() !== 'false';
        break;
      case 'allowedorigins':
        input.allowedOrigins = value
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean);
        break;
      case 'thumbnailtimestamppct': {
        const pct = Number(value);
        if (Number.isFinite(pct) && pct >= 0 && pct <= 1) input.thumbnailTimestampPct = pct;
        break;
      }
      case 'scheduleddeletion':
        if (!Number.isNaN(Date.parse(value))) input.scheduledDeletion = new Date(value);
        break;
      case 'maxdurationseconds': {
        const seconds = Number(value);
        if (Number.isInteger(seconds) && seconds > 0) input.maxDurationSeconds = seconds;
        break;
      }
      case 'expiry':
        if (!Number.isNaN(Date.parse(value))) input.uploadExpiry = new Date(value);
        break;
      case 'watermark':
        break; // Watermarks are not supported yet.
      default:
        input.meta[rawKey] = value;
    }
  }
  return input;
}
