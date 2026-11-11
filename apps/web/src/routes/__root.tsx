import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <div className="min-h-svh bg-background text-foreground">
      <Outlet />
    </div>
  ),
  // A route guard or loader failed, e.g. the API is down.
  errorComponent: () => (
    <main className="grid min-h-svh place-items-center bg-background p-4 text-foreground">
      <Alert variant="destructive" className="w-full max-w-sm">
        <AlertTitle>Cannot reach the API</AlertTitle>
        <AlertDescription>Check that the API is running, then reload the page.</AlertDescription>
      </Alert>
    </main>
  ),
  notFoundComponent: () => (
    <main className="grid min-h-svh place-items-center text-muted-foreground">Page not found.</main>
  ),
});
