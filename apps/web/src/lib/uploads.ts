import { useSyncExternalStore } from 'react';
import * as tus from 'tus-js-client';
import { client } from '@/orpc';
import { errorMessage } from '@/errors';

/*
 * Dashboard uploads. They use the same tus endpoint as the Stream-compatible API,
 * and live outside React so they keep going while the user moves between pages.
 */

/** Cloudflare Stream recommends 50 MiB chunks; each becomes one R2 part. */
const CHUNK_SIZE = 50 * 1024 * 1024;

export type UploadStatus = 'starting' | 'uploading' | 'done' | 'error' | 'canceled';

export interface UploadItem {
  id: string;
  orgId: string;
  file: File;
  uid: string | null;
  sent: number;
  status: UploadStatus;
  error: string | null;
}

let items: UploadItem[] = [];
const running = new Map<string, tus.Upload>();
const listeners = new Set<() => void>();
const doneListeners = new Set<(orgId: string) => void>();

function set(id: string, patch: Partial<UploadItem>) {
  items = items.map((item) => (item.id === id ? { ...item, ...patch } : item));
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUploads() {
  return useSyncExternalStore(subscribe, () => items);
}

/** Called when an upload finishes or its video is created, so lists can refresh. */
export function onUploadChange(listener: (orgId: string) => void) {
  doneListeners.add(listener);
  return () => void doneListeners.delete(listener);
}

export const isActive = (item: UploadItem) =>
  item.status === 'starting' || item.status === 'uploading';

export function startUploads(orgId: string, files: File[]) {
  for (const file of files) {
    const item: UploadItem = {
      id: crypto.randomUUID(),
      orgId,
      file,
      uid: null,
      sent: 0,
      status: 'starting',
      error: null,
    };
    items = [item, ...items];
    listeners.forEach((l) => l());
    void run(item);
  }
}

async function run(item: UploadItem) {
  let uploadUrl: string;
  try {
    if (!item.uid) {
      const created = await client.videos.createUpload({
        orgId: item.orgId,
        name: item.file.name,
        size: item.file.size,
      });
      item = { ...item, uid: created.uid };
      set(item.id, { uid: created.uid });
      doneListeners.forEach((l) => l(item.orgId));
      uploadUrl = created.uploadUrl;
    } else {
      uploadUrl = running.get(item.id)?.url ?? '';
    }
  } catch (err) {
    set(item.id, { status: 'error', error: errorMessage(err) });
    return;
  }

  // Cancelled while the video was being created: remove the empty video.
  if (items.find((i) => i.id === item.id)?.status === 'canceled') {
    void client.videos
      .delete({ orgId: item.orgId, uid: item.uid! })
      .catch(() => {})
      .then(() => doneListeners.forEach((l) => l(item.orgId)));
    return;
  }

  const upload = new tus.Upload(item.file, {
    uploadUrl,
    chunkSize: CHUNK_SIZE,
    retryDelays: [0, 3000, 5000, 10000, 20000],
    // The URL is one-time and tied to this video; don't reuse it across page loads.
    storeFingerprintForResuming: false,
    onProgress: (sent) => set(item.id, { sent, status: 'uploading' }),
    onSuccess: () => {
      running.delete(item.id);
      set(item.id, { sent: item.file.size, status: 'done' });
      doneListeners.forEach((l) => l(item.orgId));
    },
    onError: (err) => {
      const body = (err as tus.DetailedError).originalResponse?.getBody();
      set(item.id, { status: 'error', error: body || err.message });
    },
  });
  running.set(item.id, upload);
  set(item.id, { status: 'uploading' });
  upload.start();
}

/** Resumes a failed upload from the last chunk the server stored. */
export function retryUpload(id: string) {
  const upload = running.get(id);
  set(id, { status: 'uploading', error: null });
  if (upload) upload.start();
  else {
    const item = items.find((i) => i.id === id);
    if (item) void run({ ...item, uid: null });
  }
}

/** Stops the upload and deletes the half-uploaded video. */
export function cancelUpload(id: string) {
  const upload = running.get(id);
  running.delete(id);
  set(id, { status: 'canceled' });
  const item = items.find((i) => i.id === id);
  const notify = () => item && doneListeners.forEach((l) => l(item.orgId));
  // abort(true) also sends a tus DELETE, which removes the video; refresh lists after it.
  if (upload)
    void upload
      .abort(true)
      .catch(() => {})
      .then(notify);
  else notify();
}

/** Removes finished, failed and cancelled uploads from the list. */
export function clearFinished() {
  items = items.filter(isActive);
  listeners.forEach((l) => l());
}

// Leaving the page would stop uploads in progress.
window.addEventListener('beforeunload', (event) => {
  if (items.some(isActive)) event.preventDefault();
});

/* The upload pop-up's open state, so any page can open it. */
let dialogOpen = false;
const dialogListeners = new Set<() => void>();

export function setUploadDialogOpen(open: boolean) {
  dialogOpen = open;
  dialogListeners.forEach((l) => l());
}

export function useUploadDialogOpen() {
  return useSyncExternalStore(
    (l) => {
      dialogListeners.add(l);
      return () => dialogListeners.delete(l);
    },
    () => dialogOpen,
  );
}
