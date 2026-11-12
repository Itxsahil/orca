import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env } from './env';

export const r2 = new S3Client({
  region: env.R2_REGION,
  endpoint: env.R2_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

/** Downloads the original to a local file (R2 → this server has no egress cost). */
export async function download(key: string, file: string, signal: AbortSignal) {
  const res = await r2.send(new GetObjectCommand({ Bucket: env.R2_SOURCE_BUCKET, Key: key }), {
    abortSignal: signal,
  });
  await pipeline(res.Body as Readable, createWriteStream(file), { signal });
}

const CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
};

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name))
    .sort();
}

/** Uploads every file under `dir` to the delivery bucket under `prefix`, a few at a time. */
export async function uploadDir(dir: string, prefix: string, signal: AbortSignal) {
  const files = await listFiles(dir);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const file = files[next++]!;
      const key = prefix + path.relative(dir, file).split(path.sep).join('/');
      await r2.send(
        new PutObjectCommand({
          Bucket: env.R2_DELIVERY_BUCKET,
          Key: key,
          Body: createReadStream(file),
          ContentLength: (await stat(file)).size,
          ContentType: CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
        }),
        { abortSignal: signal },
      );
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return files.length;
}

/** Deletes everything under `prefix` in the delivery bucket (a failed or orphaned encode). */
export async function deleteOutput(prefix: string) {
  let token: string | undefined;
  do {
    const page = await r2.send(
      new ListObjectsV2Command({
        Bucket: env.R2_DELIVERY_BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    const objects = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (objects.length) {
      await r2.send(
        new DeleteObjectsCommand({
          Bucket: env.R2_DELIVERY_BUCKET,
          Delete: { Objects: objects, Quiet: true },
        }),
      );
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}
