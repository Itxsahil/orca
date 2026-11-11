import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { orpc } from './orpc';
import { navigate, usePathname } from './router';
import { SetupPage } from './pages/SetupPage';
import { LoginPage } from './pages/LoginPage';
import { InvitePage } from './pages/InvitePage';
import { AdminPage } from './pages/AdminPage';
import { HomePage } from './pages/HomePage';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ModeToggle } from '@/components/mode-toggle';

export function App() {
  const path = usePathname();
  const queryClient = useQueryClient();
  const status = useQuery(orpc.auth.status.queryOptions());
  const me = useQuery(orpc.auth.me.queryOptions());
  const logout = useMutation(
    orpc.auth.logout.mutationOptions({
      onSuccess: () => {
        queryClient.clear();
        navigate('/login', { replace: true });
      },
    }),
  );

  const inviteToken = path.startsWith('/invite/') ? path.slice('/invite/'.length) : null;
  const user = me.data;

  // Decide where each kind of visitor belongs.
  useEffect(() => {
    if (status.isPending || me.isPending || inviteToken) return;
    if (status.data?.setupRequired) return navigate('/setup', { replace: true });
    if (!user) return navigate('/login', { replace: true });
    if (path === '/login' || path === '/setup' || path === '/') {
      navigate(user.isPlatformAdmin ? '/admin' : '/home', { replace: true });
    }
  }, [status.isPending, status.data, me.isPending, user, path, inviteToken]);

  if (status.isError || me.isError) {
    return (
      <main className="grid min-h-svh place-items-center p-4">
        <Alert variant="destructive" className="w-full max-w-sm">
          <AlertTitle>Cannot reach the API</AlertTitle>
          <AlertDescription>Check that the API is running, then reload the page.</AlertDescription>
        </Alert>
      </main>
    );
  }
  if (status.isPending || me.isPending) {
    return (
      <main className="grid min-h-svh place-items-center text-muted-foreground">Loading…</main>
    );
  }

  let page;
  if (inviteToken) page = <InvitePage token={inviteToken} />;
  else if (path === '/setup') page = <SetupPage />;
  else if (path === '/login') page = <LoginPage />;
  else if (path === '/admin' && user?.isPlatformAdmin) page = <AdminPage />;
  else if (path === '/home' && user) page = <HomePage me={user} />;
  else page = null;

  return (
    <div className="min-h-svh bg-background text-foreground">
      {user ? (
        <header className="border-b">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4">
            <strong className="font-heading text-sm font-semibold">Video Platform</strong>
            <span className="ml-auto text-sm text-muted-foreground">
              {user.name} · {user.isPlatformAdmin ? 'Platform admin' : 'Owner'}
            </span>
            <ModeToggle />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => logout.mutate({})}
              disabled={logout.isPending}
            >
              Log out
            </Button>
          </div>
        </header>
      ) : (
        <div className="fixed top-3 right-3 z-50">
          <ModeToggle />
        </div>
      )}
      {page}
    </div>
  );
}
