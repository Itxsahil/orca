import { createFileRoute, Outlet } from '@tanstack/react-router';
import { ModeToggle } from '@/components/mode-toggle';

/** Layout for pages used while logged out: setup, login, invite. */
export const Route = createFileRoute('/_guest')({
  component: () => (
    <>
      <div className="fixed top-3 right-3 z-50">
        <ModeToggle />
      </div>
      <Outlet />
    </>
  ),
});
