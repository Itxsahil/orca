import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { UploadIcon } from 'lucide-react';
import { OwnerSidebar } from '@/components/owner-sidebar';
import { UploadDialog } from '@/components/upload-dialog';
import { Button } from '@/components/ui/button';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { useLogout } from '@/lib/auth';
import { isActive, onUploadChange, setUploadDialogOpen, useUploads } from '@/lib/uploads';
import { orpc } from '@/orpc';

/** Layout + guard for organization pages. Child routes get `context.org`. */
export const Route = createFileRoute('/_app/_org')({
  beforeLoad: ({ context }) => {
    // Owners belong to one organization (invite-only), so it is the current one.
    const org = context.me.orgs[0];
    if (context.me.isPlatformAdmin || !org) throw redirect({ to: '/home', replace: true });
    return { org };
  },
  component: OrgLayout,
});

function OrgLayout() {
  const { me, org } = Route.useRouteContext();
  const logout = useLogout();
  const queryClient = useQueryClient();
  const active = useUploads().filter((u) => u.orgId === org.id && isActive(u)).length;

  // Refresh the video list when an upload creates or finishes a video.
  useEffect(
    () => onUploadChange(() => void queryClient.invalidateQueries({ queryKey: orpc.videos.key() })),
    [queryClient],
  );

  return (
    <SidebarProvider>
      <OwnerSidebar me={me} orgName={org.name} onLogout={() => logout.mutate({})} />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <span className="text-sm text-muted-foreground">{org.name}</span>
          <Button size="sm" className="ml-auto" onClick={() => setUploadDialogOpen(true)}>
            <UploadIcon data-icon="inline-start" />
            {active > 0 ? `Uploading ${active}…` : 'Upload'}
          </Button>
        </header>
        <Outlet />
      </SidebarInset>
      <UploadDialog orgId={org.id} />
    </SidebarProvider>
  );
}
