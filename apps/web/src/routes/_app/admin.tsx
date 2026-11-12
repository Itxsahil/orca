import { createFileRoute, redirect } from '@tanstack/react-router';

/** Guard for everything under /admin: platform admin only. */
export const Route = createFileRoute('/_app/admin')({
  beforeLoad: ({ context }) => {
    if (!context.me.isPlatformAdmin) throw redirect({ to: '/home', replace: true });
  },
});
