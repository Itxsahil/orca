import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** "Ban" with an optional reason, or "Unban" when already banned. */
export function BanControl({
  banned,
  pending,
  onBan,
  onUnban,
}: {
  banned: boolean;
  pending?: boolean;
  onBan: (reason: string) => void;
  onUnban: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');

  if (banned) {
    return (
      <Button variant="outline" size="sm" disabled={pending} onClick={onUnban}>
        Unban
      </Button>
    );
  }
  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive"
        onClick={() => setConfirming(true)}
      >
        Ban
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
      onSubmit={(e) => {
        e.preventDefault();
        onBan(reason.trim());
        setConfirming(false);
        setReason('');
      }}
    >
      <Input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        aria-label="Ban reason"
        maxLength={500}
        className="h-8 min-w-0 flex-1 sm:w-48"
      />
      <Button type="submit" variant="destructive" size="sm" disabled={pending}>
        Confirm ban
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </form>
  );
}
