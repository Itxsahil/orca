import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrgSummary } from '@repo/contract';
import { orpc } from '../orpc';
import { errorMessage } from '../errors';

/** Platform admin: create organizations and hand out owner invite links. */
export function AdminPage() {
  const queryClient = useQueryClient();
  const orgs = useQuery(orpc.admin.orgs.list.queryOptions());
  const [form, setForm] = useState({ name: '', ownerEmail: '' });
  const [lastLink, setLastLink] = useState<{ label: string; url: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.key() });

  const create = useMutation(
    orpc.admin.orgs.create.mutationOptions({
      onSuccess: (res, vars) => {
        setLastLink({ label: `Invite for ${vars.ownerEmail} (${vars.name})`, url: res.inviteUrl });
        setForm({ name: '', ownerEmail: '' });
        void refresh();
      },
    }),
  );
  const reinvite = useMutation(
    orpc.admin.invites.create.mutationOptions({
      onSuccess: (res, vars) => {
        setLastLink({ label: `New invite for ${vars.email}`, url: res.inviteUrl });
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
    <main className="page">
      <h1>Organizations</h1>

      <form className="card row-form" onSubmit={submit}>
        <label>
          Organization name
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          Owner email
          <input
            required
            type="email"
            value={form.ownerEmail}
            onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
          />
        </label>
        <button type="submit" disabled={create.isPending}>
          Create + invite
        </button>
      </form>

      {lastLink && <InviteLink {...lastLink} onClose={() => setLastLink(null)} />}
      {error && <p className="error">{errorMessage(error)}</p>}

      {orgs.isPending && <p className="muted">Loading…</p>}
      {orgs.data?.length === 0 && <p className="muted">No organizations yet.</p>}
      <div className="list">
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
  return (
    <article className="card">
      <div className="org-head">
        <strong>{org.name}</strong>
        <span className="muted">created {org.createdAt.toLocaleDateString()}</span>
      </div>
      {org.owners.length > 0 ? (
        <p>Owner: {org.owners.map((o) => `${o.name} <${o.email}>`).join(', ')}</p>
      ) : latest ? (
        <div className="invite-row">
          <span>
            Invite to {latest.email}:{' '}
            <span className={`status ${latest.status}`}>{latest.status}</span>
            {latest.status === 'pending' && (
              <span className="muted"> · expires {latest.expiresAt.toLocaleDateString()}</span>
            )}
          </span>
          <span className="actions">
            {latest.status === 'pending' && (
              <button className="ghost" onClick={() => onRevoke(latest.id)}>
                Revoke
              </button>
            )}
            <button className="ghost" onClick={() => onReinvite(latest.email)}>
              New link
            </button>
          </span>
        </div>
      ) : (
        <p className="muted">No owner and no invite.</p>
      )}
    </article>
  );
}

function InviteLink({ label, url, onClose }: { label: string; url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };
  return (
    <div className="card notice" role="status">
      <strong>{label}</strong>
      <p className="muted">
        Send this link to the owner. It is shown only once and works one time.
      </p>
      <div className="copy-row">
        <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Invite link" />
        <button type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
