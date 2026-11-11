import type { QueryClient } from '@tanstack/react-query';
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
  return me.isPlatformAdmin ? ('/admin' as const) : ('/home' as const);
}
