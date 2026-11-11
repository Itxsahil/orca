import { createFileRoute } from '@tanstack/react-router';
import { HomePage } from '@/pages/HomePage';

export const Route = createFileRoute('/_app/home')({
  component: function HomeRoute() {
    const { me } = Route.useRouteContext();
    return <HomePage me={me} />;
  },
});
