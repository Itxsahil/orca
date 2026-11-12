import { env } from '../env';

/** One-time basic (form) upload URL, like Stream's https://upload.videodelivery.net/<uid>. */
export const basicUploadUrl = (uid: string) => `${env.STREAM_PUBLIC_URL}/upload/${uid}`;

/** tus upload URL (the Location of a tus creation). */
export const tusUploadUrl = (uid: string) => `${env.STREAM_PUBLIC_URL}/upload/tus/${uid}`;
