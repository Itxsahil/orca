import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { SimpleCsrfProtectionLinkPlugin } from '@orpc/client/plugins';
import type { ContractRouterClient } from '@orpc/contract';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import type { Contract } from '@repo/contract';

const link = new RPCLink({
  url: `${import.meta.env.VITE_API_URL ?? window.location.origin}/rpc`,
  // Send the session cookie, also when the API lives on another origin (VITE_API_URL).
  fetch: (request, init) => fetch(request, { ...init, credentials: 'include' }),
  // Adds the x-csrf-token header the API requires.
  plugins: [new SimpleCsrfProtectionLinkPlugin()],
});

/** Fully typed client generated from the shared contract. */
export const client: ContractRouterClient<Contract> = createORPCClient(link);

/** TanStack Query helpers: orpc.auth.me.queryOptions(), .mutationOptions(), .key() */
export const orpc = createTanstackQueryUtils(client);
