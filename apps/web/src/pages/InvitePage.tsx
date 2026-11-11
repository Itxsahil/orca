import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { orpc } from '@/orpc';
import { errorMessage } from '@/errors';
import { useSignedIn } from './useSignedIn';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function InvitePage({ token }: { token: string }) {
  const signedIn = useSignedIn();
  const [form, setForm] = useState({ name: '', password: '' });
  const preview = useQuery({
    ...orpc.invites.preview.queryOptions({ input: { token } }),
    retry: false,
  });
  const accept = useMutation(orpc.invites.accept.mutationOptions({ onSuccess: signedIn }));

  if (preview.isPending) {
    return (
      <main className="grid min-h-svh place-items-center text-muted-foreground">
        Checking your invite…
      </main>
    );
  }
  if (preview.isError) {
    return (
      <main className="grid min-h-svh place-items-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-xl">Invite unavailable</CardTitle>
            <CardDescription>This link cannot be used to create an account.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(preview.error)}</AlertDescription>
            </Alert>
            <Button asChild variant="outline" className="w-full">
              <Link to="/login">Go to log in</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    accept.mutate({ token, ...form });
  };

  return (
    <main className="grid min-h-svh place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Join {preview.data.orgName}</CardTitle>
          <CardDescription>You have been invited as the organization owner.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={preview.data.email} disabled />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                required
                autoComplete="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Choose a password</Label>
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
            {accept.error && (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage(accept.error)}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={accept.isPending}>
              {accept.isPending ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
