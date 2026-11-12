import { useRef, useState, type DragEvent } from 'react';
import { RotateCwIcon, UploadIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { formatBytes } from '@/lib/format';
import {
  cancelUpload,
  clearFinished,
  isActive,
  retryUpload,
  setUploadDialogOpen,
  startUploads,
  useUploadDialogOpen,
  useUploads,
  type UploadItem,
} from '@/lib/uploads';
import { cn } from '@/lib/utils';

const STATUS_TEXT: Record<UploadItem['status'], string> = {
  starting: 'Starting…',
  uploading: 'Uploading',
  done: 'Uploaded',
  error: 'Failed',
  canceled: 'Cancelled',
};

/** The upload pop-up. Uploads keep running when it is closed. */
export function UploadDialog({ orgId }: { orgId: string }) {
  const open = useUploadDialogOpen();
  const uploads = useUploads().filter((u) => u.orgId === orgId);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const add = (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (list.length) startUploads(orgId, list);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    add(event.dataTransfer.files);
  };

  return (
    <Dialog open={open} onOpenChange={setUploadDialogOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload videos</DialogTitle>
          <DialogDescription>
            Any video format, up to 30 GB each. You can close this window: uploads continue while
            you use the app.
          </DialogDescription>
        </DialogHeader>

        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-sm transition-colors hover:bg-muted/50',
            dragging && 'border-foreground bg-muted/50',
          )}
        >
          <UploadIcon className="size-5 text-muted-foreground" />
          <span className="font-medium">Drop videos here or click to choose</span>
        </button>
        <input
          ref={input}
          type="file"
          accept="video/*"
          multiple
          hidden
          onChange={(e) => {
            add(e.target.files);
            e.target.value = '';
          }}
        />

        {uploads.length > 0 && (
          <ul className="grid max-h-72 gap-3 overflow-y-auto">
            {uploads.map((u) => (
              <UploadRow key={u.id} item={u} />
            ))}
          </ul>
        )}

        <DialogFooter>
          {uploads.some((u) => !isActive(u)) && (
            <Button variant="ghost" onClick={clearFinished}>
              Clear finished
            </Button>
          )}
          <Button onClick={() => setUploadDialogOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadRow({ item }: { item: UploadItem }) {
  const pct = item.file.size ? Math.floor((item.sent / item.file.size) * 100) : 0;
  return (
    <li className="grid gap-1.5" data-testid="upload-row">
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium">{item.file.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {item.status === 'uploading'
            ? `${pct}% · ${formatBytes(item.sent)} of ${formatBytes(item.file.size)}`
            : `${STATUS_TEXT[item.status]} · ${formatBytes(item.file.size)}`}
        </span>
        {isActive(item) && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Cancel ${item.file.name}`}
            onClick={() => cancelUpload(item.id)}
          >
            <XIcon />
          </Button>
        )}
        {item.status === 'error' && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Retry ${item.file.name}`}
            onClick={() => retryUpload(item.id)}
          >
            <RotateCwIcon />
          </Button>
        )}
      </div>
      {item.status !== 'canceled' && <Progress value={item.status === 'done' ? 100 : pct} />}
      {item.error && <p className="text-xs text-destructive">{item.error}</p>}
    </li>
  );
}
