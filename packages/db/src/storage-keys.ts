/*
 * Where a video's files live in R2. Shared by the API and the encoder.
 * User-supplied names never end up in keys.
 */

/** The original upload, in the source bucket. */
export const sourceKey = (orgId: string, uid: string) => `${orgId}/${uid}/original`;

/** Everything the encoder produces (HLS, thumbnails), in the delivery bucket. */
export const deliveryPrefix = (orgId: string, uid: string) => `${orgId}/${uid}/`;
