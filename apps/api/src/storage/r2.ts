import { S3Client } from '@aws-sdk/client-s3';
import { env } from '../env';

/**
 * S3 client for Cloudflare R2 (or any S3-compatible store in development).
 * - region "auto" and path-style URLs work for R2 and local stores alike
 * - checksums only when required: newer AWS SDKs add CRC checksums to every
 *   request by default, which R2-style stores may reject
 * Stick to the S3 operations R2 supports (no ACLs, no presigned POST).
 */
export const r2 = new S3Client({
  region: env.R2_REGION,
  endpoint: env.R2_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

export const buckets = {
  source: env.R2_SOURCE_BUCKET,
  delivery: env.R2_DELIVERY_BUCKET,
};

/** Where an original upload lives. User-supplied file names never end up in keys. */
export const sourceKey = (orgId: string, uid: string) => `${orgId}/${uid}/original`;
