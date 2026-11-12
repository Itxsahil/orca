import { createFileRoute, redirect } from '@tanstack/react-router';
import { HomePage } from '@/pages/HomePage';

/** Users without an organization land here; owners go straight to their videos. */
export const Route = createFileRoute('/_app/home')({
  beforeLoad: ({ context }) => {
    if (context.me.orgs.length > 0) throw redirect({ to: '/videos', replace: true });
  },
  component: function HomeRoute() {
    const { me } = Route.useRouteContext();
    return <HomePage me={me} />;
  },
});
