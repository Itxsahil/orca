import { createFileRoute, redirect } from '@tanstack/react-router';
import { getAuth, homePath } from '@/lib/auth';

/** "/" only sends each visitor where they belong. */
export const Route = createFileRoute('/')({
  beforeLoad: async ({ context }) => {
    const { setupRequired, me } = await getAuth(context.queryClient);
    if (setupRequired) throw redirect({ to: '/setup', replace: true });
    if (!me) throw redirect({ to: '/login', replace: true });
    throw redirect({ to: homePath(me), replace: true });
  },
});
