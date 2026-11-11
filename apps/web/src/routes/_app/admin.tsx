import { createFileRoute, redirect } from '@tanstack/react-router';
import { orpc } from '@/orpc';
import { AdminPage } from '@/pages/AdminPage';

export const Route = createFileRoute('/_app/admin')({
  beforeLoad: ({ context }) => {
    if (!context.me.isPlatformAdmin) throw redirect({ to: '/home', replace: true });
  },
  // Start loading the organizations before the page renders (AdminPage reads the same query).
  loader: ({ context }) => context.queryClient.ensureQueryData(orpc.admin.orgs.list.queryOptions()),
  component: AdminPage,
});
