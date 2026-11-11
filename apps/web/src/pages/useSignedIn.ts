import { useQueryClient } from '@tanstack/react-query';
import type { Me } from '@repo/contract';
import { orpc } from '../orpc';
import { navigate } from '../router';

/** After login / setup / accepting an invite: store the user and go to their home page. */
export function useSignedIn() {
  const queryClient = useQueryClient();
  return (me: Me) => {
    queryClient.setQueryData(orpc.auth.me.queryKey(), me);
    void queryClient.invalidateQueries({ queryKey: orpc.auth.status.queryKey() });
    navigate(me.isPlatformAdmin ? '/admin' : '/home', { replace: true });
  };
}
