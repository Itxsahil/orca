import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { orpc } from './orpc';
import { navigate, usePathname } from './router';
import { SetupPage } from './pages/SetupPage';
import { LoginPage } from './pages/LoginPage';
import { InvitePage } from './pages/InvitePage';
import { AdminPage } from './pages/AdminPage';
import { HomePage } from './pages/HomePage';

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
      <main className="center">
        <p className="error">Cannot reach the API.</p>
      </main>
    );
  }
  if (status.isPending || me.isPending) return <main className="center muted">Loading…</main>;

  let page;
  if (inviteToken) page = <InvitePage token={inviteToken} />;
  else if (path === '/setup') page = <SetupPage />;
  else if (path === '/login') page = <LoginPage />;
  else if (path === '/admin' && user?.isPlatformAdmin) page = <AdminPage />;
  else if (path === '/home' && user) page = <HomePage me={user} />;
  else page = null;

  return (
    <>
      {user && (
        <header className="topbar">
          <strong>Video Platform</strong>
          <span className="muted">
            {user.name} · {user.isPlatformAdmin ? 'Platform admin' : 'Owner'}
          </span>
          <button className="ghost" onClick={() => logout.mutate({})} disabled={logout.isPending}>
            Log out
          </button>
        </header>
      )}
      {page}
    </>
  );
}
