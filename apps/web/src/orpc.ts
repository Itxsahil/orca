import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import type { Contract } from '@repo/contract';

const link = new RPCLink({
  url: `${import.meta.env.VITE_API_URL ?? window.location.origin}/rpc`,
});

/** Fully typed client generated from the shared contract. */
export const client: ContractRouterClient<Contract> = createORPCClient(link);

/** TanStack Query helpers: orpc.health.queryOptions(), .mutationOptions(), .key() */
export const orpc = createTanstackQueryUtils(client);
