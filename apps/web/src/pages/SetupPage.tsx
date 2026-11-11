import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { orpc } from '../orpc';
import { errorMessage } from '../errors';
import { useSignedIn } from './useSignedIn';

/** First run only: creates the platform admin (must match PLATFORM_ADMIN_EMAIL). */
export function SetupPage() {
  const signedIn = useSignedIn();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const setup = useMutation(orpc.auth.setup.mutationOptions({ onSuccess: signedIn }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setup.mutate(form);
  };

  return (
    <main className="center">
      <form className="card" onSubmit={submit}>
        <h1>Set up the platform</h1>
        <p className="muted">
          Create the platform admin account. Use the email set in PLATFORM_ADMIN_EMAIL.
        </p>
        <label>
          Name
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoComplete="name"
          />
        </label>
        <label>
          Email
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            required
            type="password"
            minLength={8}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            autoComplete="new-password"
          />
        </label>
        {setup.error && <p className="error">{errorMessage(setup.error)}</p>}
        <button type="submit" disabled={setup.isPending}>
          {setup.isPending ? 'Creating…' : 'Create admin account'}
        </button>
      </form>
    </main>
  );
}
