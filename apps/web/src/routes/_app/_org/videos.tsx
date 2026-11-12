import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  CopyIcon,
  FilmIcon,
  LoaderCircleIcon,
  Trash2Icon,
  UploadIcon,
  XCircleIcon,
} from 'lucide-react';
import type { VideoSummary } from '@repo/contract';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatBytes, formatDate, formatDuration } from '@/lib/format';
import { setUploadDialogOpen, useUploads } from '@/lib/uploads';
import { errorMessage } from '@/errors';
import { orpc } from '@/orpc';

export const Route = createFileRoute('/_app/_org/videos')({ component: VideosPage });

/** States that change on their own, so the list keeps polling while any video is in one. */
const BUSY = new Set<VideoSummary['state']>([
  'pendingupload',
  'downloading',
  'queued',
  'inprogress',
]);

function VideosPage() {
  const { org } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const uploads = useUploads();
  const [toDelete, setToDelete] = useState<VideoSummary | null>(null);

  const videos = useQuery(
    orpc.videos.list.queryOptions({
      input: { orgId: org.id },
      refetchInterval: (q) => (q.state.data?.some((v) => BUSY.has(v.state)) ? 5000 : false),
    }),
  );
  const remove = useMutation(
    orpc.videos.delete.mutationOptions({
      onSuccess: () => {
        setToDelete(null);
        void queryClient.invalidateQueries({ queryKey: orpc.videos.key() });
      },
    }),
  );

  // Live progress for uploads running in this browser.
  const localProgress = (uid: string) => {
    const u = uploads.find((x) => x.uid === uid && x.status === 'uploading');
    return u && u.file.size ? Math.floor((u.sent / u.file.size) * 100) : null;
  };

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8 md:px-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Videos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything uploaded to {org.name}, from this dashboard or the API.
        </p>
      </div>

      {(videos.error || remove.error) && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(videos.error ?? remove.error)}</AlertDescription>
        </Alert>
      )}

      {videos.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : videos.data?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <FilmIcon className="size-6 text-muted-foreground" />
            <div>
              <p className="font-medium">No videos yet</p>
              <p className="text-sm text-muted-foreground">
                Upload from here, or with the API from your own app.
              </p>
            </div>
            <Button onClick={() => setUploadDialogOpen(true)}>
              <UploadIcon data-icon="inline-start" />
              Upload videos
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-0 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {videos.data?.map((v) => (
                <TableRow key={v.uid}>
                  <TableCell className="max-w-64 pl-4">
                    <div className="truncate font-medium">{v.name ?? 'Untitled'}</div>
                    <div className="font-mono text-xs text-muted-foreground">{v.uid}</div>
                  </TableCell>
                  <TableCell>
                    <VideoStatus video={v} localPct={localProgress(v.uid)} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDuration(v.duration)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatBytes(v.size)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(v.created)}</TableCell>
                  <TableCell className="pr-4">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Copy video ID"
                        onClick={() => void navigator.clipboard.writeText(v.uid)}
                      >
                        <CopyIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${v.name ?? v.uid}`}
                        onClick={() => setToDelete(v)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete video?</DialogTitle>
            <DialogDescription>
              {toDelete?.name ?? toDelete?.uid} and its files are deleted for good. Players and API
              clients using it stop working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => toDelete && remove.mutate({ orgId: org.id, uid: toDelete.uid })}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function VideoStatus({ video, localPct }: { video: VideoSummary; localPct: number | null }) {
  const row = (Icon: typeof CheckCircle2Icon, text: string, spin = false, className = '') => (
    <span className={`inline-flex items-center gap-1.5 text-sm whitespace-nowrap ${className}`}>
      <Icon className={`size-4 ${spin ? 'animate-spin' : ''}`} />
      {text}
    </span>
  );
  switch (video.state) {
    case 'pendingupload': {
      const pct =
        localPct ??
        (video.size && video.uploadOffset
          ? Math.floor((video.uploadOffset / video.size) * 100)
          : null);
      return row(
        CircleDashedIcon,
        pct == null ? 'Waiting for upload' : `Uploading ${pct}%`,
        false,
        'text-muted-foreground',
      );
    }
    case 'downloading':
      return row(LoaderCircleIcon, 'Downloading', true);
    case 'queued':
      return row(CircleDashedIcon, 'Queued for encoding', false, 'text-muted-foreground');
    case 'inprogress':
      return row(
        LoaderCircleIcon,
        video.pctComplete == null ? 'Encoding' : `Encoding ${Math.floor(video.pctComplete)}%`,
        true,
      );
    case 'ready':
      return row(CheckCircle2Icon, 'Ready');
    case 'error':
      return (
        <span title={video.errorReasonText ?? undefined}>
          {row(XCircleIcon, 'Failed', false, 'text-destructive')}
        </span>
      );
  }
}
