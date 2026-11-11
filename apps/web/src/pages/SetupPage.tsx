import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { orpc } from '@/orpc';
import { errorMessage } from '@/errors';
import { useSignedIn } from './useSignedIn';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
    <main className="grid min-h-svh place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Set up the platform</CardTitle>
          <CardDescription>
            Create the platform admin account. Use the email set in PLATFORM_ADMIN_EMAIL.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                required
                autoComplete="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            {setup.error && (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage(setup.error)}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={setup.isPending}>
              {setup.isPending ? 'Creating…' : 'Create admin account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
