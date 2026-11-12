import { Link, useMatchRoute } from '@tanstack/react-router';
import { Building2Icon, LogOutIcon, UsersIcon } from 'lucide-react';
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

const NAV = [
  { to: '/admin/organizations', label: 'Organizations', icon: Building2Icon },
  { to: '/admin/clients', label: 'Clients', icon: UsersIcon },
] as const;

/** Navigation for the platform admin. */
export function AdminSidebar({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const matchRoute = useMatchRoute();
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="px-2 py-1.5 font-heading text-sm font-semibold">Video Platform</div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild isActive={!!matchRoute({ to: item.to, fuzzy: true })}>
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
