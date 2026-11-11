import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { Me } from '@repo/contract';
import { homePath } from '@/lib/auth';
import { orpc } from '../orpc';

/** After login / setup / accepting an invite: store the user and go to their home page. */
export function useSignedIn() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (me: Me) => {
    // Route guards read these from the cache, so update them before navigating.
    queryClient.setQueryData(orpc.auth.me.queryKey(), me);
    queryClient.setQueryData(orpc.auth.status.queryKey(), { setupRequired: false });
    void navigate({ to: homePath(me), replace: true });
  };
}
