import { createFileRoute, redirect } from '@tanstack/react-router';
import { getAuth } from '@/lib/auth';
import { SetupPage } from '@/pages/SetupPage';

export const Route = createFileRoute('/_guest/setup')({
  beforeLoad: async ({ context }) => {
    const { setupRequired } = await getAuth(context.queryClient);
    // Setup happens once; afterwards "/" sends people to login or their home.
    if (!setupRequired) throw redirect({ to: '/', replace: true });
  },
  component: SetupPage,
});
