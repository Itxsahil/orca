import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { Me } from '@repo/contract';
import { orpc } from '@/orpc';

/**
 * Auth state for route guards. Uses the TanStack Query cache, so navigating
 * between pages does not refetch; login / logout update the cache directly.
 */
export async function getAuth(queryClient: QueryClient) {
  const [status, me] = await Promise.all([
    queryClient.ensureQueryData(orpc.auth.status.queryOptions()),
    queryClient.ensureQueryData(orpc.auth.me.queryOptions()),
  ]);
  return { setupRequired: status.setupRequired, me };
}

/** Where a logged-in user lands. */
export function homePath(me: Me) {
  if (me.isPlatformAdmin) return '/admin' as const;
  return me.orgs.length > 0 ? ('/videos' as const) : ('/home' as const);
}

/** Logs out, clears cached data and goes to the login page. */
export function useLogout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation(
    orpc.auth.logout.mutationOptions({
      onSuccess: () => {
        queryClient.clear();
        void navigate({ to: '/login', replace: true });
      },
    }),
  );
}
