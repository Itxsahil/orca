import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrgSummary } from '@repo/contract';
import { orpc } from '@/orpc';
import { errorMessage } from '@/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type InviteStatus = OrgSummary['invites'][number]['status'];

const STATUS_BADGE: Record<
  InviteStatus,
  { variant: 'outline' | 'destructive'; className: string }
> = {
  pending: { variant: 'outline', className: 'border-warn/40 text-warn' },
  accepted: { variant: 'outline', className: 'border-ok/40 text-ok' },
  revoked: { variant: 'destructive', className: '' },
  expired: { variant: 'destructive', className: '' },
};

/** Platform admin: create organizations and hand out owner invite links. */
export function AdminPage() {
  const queryClient = useQueryClient();
  const orgs = useQuery(orpc.admin.orgs.list.queryOptions());
  const [form, setForm] = useState({ name: '', ownerEmail: '' });
  const [lastLink, setLastLink] = useState<InviteLinkProps | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.key() });

  const create = useMutation(
    orpc.admin.orgs.create.mutationOptions({
      onSuccess: (res, vars) => {
        setLastLink({
          label: `Invite for ${vars.ownerEmail} (${vars.name})`,
          url: res.inviteUrl,
          email: vars.ownerEmail,
          emailSent: res.emailSent,
          emailError: res.emailError,
        });
        setForm({ name: '', ownerEmail: '' });
        void refresh();
      },
    }),
  );
  const reinvite = useMutation(
    orpc.admin.invites.create.mutationOptions({
      onSuccess: (res, vars) => {
        setLastLink({
          label: `New invite for ${vars.email}`,
          url: res.inviteUrl,
          email: vars.email,
          emailSent: res.emailSent,
          emailError: res.emailError,
        });
        void refresh();
      },
    }),
  );
  const revoke = useMutation(
    orpc.admin.invites.revoke.mutationOptions({ onSuccess: () => void refresh() }),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(form);
  };

  const error = create.error ?? reinvite.error ?? revoke.error ?? orgs.error;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Organizations</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Create an organization and invite its owner.
      </p>

      <Card className="mt-6">
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="org-name">Organization name</Label>
              <Input
                id="org-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="owner-email">Owner email</Label>
              <Input
                id="owner-email"
                required
                type="email"
                value={form.ownerEmail}
                onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
              />
            </div>
            <Button type="submit" disabled={create.isPending}>
              Create + invite
            </Button>
          </form>
        </CardContent>
      </Card>

      {lastLink && <InviteLink {...lastLink} onClose={() => setLastLink(null)} />}

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{errorMessage(error)}</AlertDescription>
        </Alert>
      )}

      <div className="mt-8 grid gap-3">
        {orgs.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {orgs.data?.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No organizations yet.
            </CardContent>
          </Card>
        )}
        {orgs.data?.map((org) => (
          <OrgCard
            key={org.id}
            org={org}
            onReinvite={(email) => reinvite.mutate({ orgId: org.id, email })}
            onRevoke={(inviteId) => revoke.mutate({ inviteId })}
          />
        ))}
      </div>
    </main>
  );
}

function OrgCard({
  org,
  onReinvite,
  onRevoke,
}: {
  org: OrgSummary;
  onReinvite: (email: string) => void;
  onRevoke: (inviteId: string) => void;
}) {
  const latest = org.invites[0];
  const badge = latest ? STATUS_BADGE[latest.status] : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <CardTitle>{org.name}</CardTitle>
          <CardDescription>Created {org.createdAt.toLocaleDateString()}</CardDescription>
        </div>
        {latest && badge && (
          <Badge variant={badge.variant} className={`capitalize ${badge.className}`}>
            {latest.status}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {org.owners.length > 0 ? (
          <p className="text-sm">
            Owner: {org.owners.map((o) => `${o.name} <${o.email}>`).join(', ')}
          </p>
        ) : latest ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              Invite to {latest.email}
              {latest.status === 'pending' && (
                <span className="text-muted-foreground">
                  {' '}
                  · expires {latest.expiresAt.toLocaleDateString()}
                </span>
              )}
            </p>
            <div className="flex gap-1">
              {latest.status === 'pending' && (
                <Button variant="ghost" size="sm" onClick={() => onRevoke(latest.id)}>
                  Revoke
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => onReinvite(latest.email)}>
                New link
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No owner and no invite.</p>
        )}
      </CardContent>
    </Card>
  );
}

interface InviteLinkProps {
  label: string;
  url: string;
  email: string;
  emailSent: boolean;
  emailError: string | null;
}

function InviteLink({
  label,
  url,
  email,
  emailSent,
  emailError,
  onClose,
}: InviteLinkProps & { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };
  return (
    <Card className="mt-4 border-primary/40">
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
        <CardDescription>
          {emailSent
            ? `Invite emailed to ${email}. You can also copy the link below; it is shown only once and works one time.`
            : 'Send this link to the owner. It is shown only once and works one time.'}
        </CardDescription>
      </CardHeader>
      {!emailSent && emailError && (
        <CardContent>
          <Alert>
            <AlertDescription>The invite email was not sent: {emailError}</AlertDescription>
          </Alert>
        </CardContent>
      )}
      <CardContent className="flex flex-col gap-2 sm:flex-row">
        <Input
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          aria-label="Invite link"
          className="font-mono text-xs"
        />
        <div className="flex gap-2">
          <Button type="button" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
