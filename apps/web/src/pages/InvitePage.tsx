import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { orpc } from '../orpc';
import { errorMessage } from '../errors';
import { useSignedIn } from './useSignedIn';

export function InvitePage({ token }: { token: string }) {
  const signedIn = useSignedIn();
  const [form, setForm] = useState({ name: '', password: '' });
  const preview = useQuery({
    ...orpc.invites.preview.queryOptions({ input: { token } }),
    retry: false,
  });
  const accept = useMutation(orpc.invites.accept.mutationOptions({ onSuccess: signedIn }));

  if (preview.isPending) return <main className="center muted">Checking your invite…</main>;
  if (preview.isError) {
    return (
      <main className="center">
        <div className="card">
          <h1>Invite unavailable</h1>
          <p className="error">{errorMessage(preview.error)}</p>
          <a href="/login">Go to log in</a>
        </div>
      </main>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    accept.mutate({ token, ...form });
  };

  return (
    <main className="center">
      <form className="card" onSubmit={submit}>
        <h1>Join {preview.data.orgName}</h1>
        <p className="muted">You have been invited as the organization owner.</p>
        <label>
          Email
          <input value={preview.data.email} disabled />
        </label>
        <label>
          Your name
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoComplete="name"
          />
        </label>
        <label>
          Choose a password
          <input
            required
            type="password"
            minLength={8}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            autoComplete="new-password"
          />
        </label>
        {accept.error && <p className="error">{errorMessage(accept.error)}</p>}
        <button type="submit" disabled={accept.isPending}>
          {accept.isPending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </main>
  );
}
