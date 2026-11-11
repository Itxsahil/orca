import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { ModeToggle } from '@/components/mode-toggle';
import { getAuth } from '@/lib/auth';
import { orpc } from '@/orpc';

/** Layout + guard for every logged-in page. Child routes get `context.me`. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    const { setupRequired, me } = await getAuth(context.queryClient);
    if (setupRequired) throw redirect({ to: '/setup', replace: true });
    if (!me) throw redirect({ to: '/login', replace: true });
    return { me };
  },
  component: AppLayout,
});

function AppLayout() {
  const { me } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useMutation(
    orpc.auth.logout.mutationOptions({
      onSuccess: () => {
        queryClient.clear();
        void navigate({ to: '/login', replace: true });
      },
    }),
  );

  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4">
          <strong className="font-heading text-sm font-semibold">Video Platform</strong>
          <span className="ml-auto text-sm text-muted-foreground">
            {me.name} · {me.isPlatformAdmin ? 'Platform admin' : 'Owner'}
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
      <Outlet />
    </>
  );
}
