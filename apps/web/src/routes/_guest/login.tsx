import { createFileRoute, redirect } from '@tanstack/react-router';
import { getAuth, homePath } from '@/lib/auth';
import { LoginPage } from '@/pages/LoginPage';

export const Route = createFileRoute('/_guest/login')({
  beforeLoad: async ({ context }) => {
    const { setupRequired, me } = await getAuth(context.queryClient);
    if (setupRequired) throw redirect({ to: '/setup', replace: true });
    if (me) throw redirect({ to: homePath(me), replace: true });
  },
  component: LoginPage,
});
