import { createFileRoute } from '@tanstack/react-router';
import { InvitePage } from '@/pages/InvitePage';

/** Public: anyone with the link can open it, logged in or not. */
export const Route = createFileRoute('/_guest/invite/$token')({
  component: function InviteRoute() {
    const { token } = Route.useParams();
    return <InvitePage token={token} />;
  },
});
