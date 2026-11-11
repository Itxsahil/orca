import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { orpc } from '../orpc';
import { errorMessage } from '../errors';
import { useSignedIn } from './useSignedIn';

export function LoginPage() {
  const signedIn = useSignedIn();
  const [form, setForm] = useState({ email: '', password: '' });
  const login = useMutation(orpc.auth.login.mutationOptions({ onSuccess: signedIn }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate(form);
  };

  return (
    <main className="center">
      <form className="card" onSubmit={submit}>
        <h1>Log in</h1>
        <p className="muted">
          Accounts are invite-only. Use the link you were sent to create yours.
        </p>
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
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            autoComplete="current-password"
          />
        </label>
        {login.error && <p className="error">{errorMessage(login.error)}</p>}
        <button type="submit" disabled={login.isPending}>
          {login.isPending ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </main>
  );
}
