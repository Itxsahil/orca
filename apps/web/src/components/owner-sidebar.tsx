import { Link, useMatchRoute } from '@tanstack/react-router';
import { FilmIcon, KeyRoundIcon, LogOutIcon } from 'lucide-react';
import type { Me } from '@repo/contract';
import { ModeToggle } from '@/components/mode-toggle';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

const GROUPS = [
  { label: 'Library', items: [{ to: '/videos', label: 'Videos', icon: FilmIcon }] },
  { label: 'Developers', items: [{ to: '/api-keys', label: 'API keys', icon: KeyRoundIcon }] },
] as const;

/** Navigation for organization owners. */
export function OwnerSidebar({
  me,
  orgName,
  onLogout,
}: {
  me: Me;
  orgName: string;
  onLogout: () => void;
}) {
  const matchRoute = useMatchRoute();
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="grid px-2 py-1.5 leading-tight">
          <span className="truncate font-heading text-sm font-semibold">{orgName}</span>
          <span className="text-xs text-muted-foreground">Video Platform</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={!!matchRoute({ to: item.to, fuzzy: true })}
                    >
                      <Link to={item.to}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="grid min-w-0 flex-1 text-sm leading-tight">
            <span className="truncate font-medium">{me.name}</span>
            <span className="truncate text-xs text-muted-foreground">{me.email}</span>
          </div>
          <ModeToggle />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onLogout}>
              <LogOutIcon />
              <span>Log out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
