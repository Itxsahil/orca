/*
 * Creates the two private buckets and a lifecycle rule that discards abandoned
 * multipart uploads. Safe to run repeatedly.  npm run storage:setup
 */
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3';
import { buckets, r2 } from '../src/storage/r2';

for (const bucket of [buckets.source, buckets.delivery]) {
  try {
    await r2.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`bucket ${bucket}: exists`);
  } catch {
    await r2.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`bucket ${bucket}: created (private)`);
  }
}

try {
  await r2.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: buckets.source,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: 'abort-abandoned-uploads',
            Status: 'Enabled',
            Filter: { Prefix: '' },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 2 },
          },
        ],
      },
    }),
  );
  console.log(`bucket ${buckets.source}: abandoned uploads are discarded after 2 days`);
} catch (err) {
  // Some local S3 stand-ins do not implement lifecycle rules; R2 does.
  console.warn(`could not set the lifecycle rule (${(err as Error).name}); fine for local dev`);
}
