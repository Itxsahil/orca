import type {
  RequestHeadersPluginContext,
  ResponseHeadersPluginContext,
} from '@orpc/server/plugins';
import type { Db } from '@repo/db';
import type { Redis } from './redis';

/**
 * Everything a procedure handler can use. `reqHeaders` / `resHeaders` are filled
 * in by oRPC plugins and are how handlers read and set cookies.
 */
export interface Context extends RequestHeadersPluginContext, ResponseHeadersPluginContext {
  db: Db;
  redis: Redis;
  /** Client IP (honours TRUST_PROXY), used for rate limiting. */
  ip: string;
}
