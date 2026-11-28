import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
  normalizeIp,
} from '@nestjs/throttler';
import { isIP } from 'node:net';
import { AppConfig } from '../../../common/config/app-config';
import { APP_CONFIG } from '../../../common/config/config.token';

interface HttpRequestLike {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  ip?: string;
}

/**
 * G-12 / STM-24 (IP-5 Step 9): rate limiting on the public catalog browsing and search
 * endpoints only. Applied with @UseGuards on PublicCatalogController alone — there is no
 * global APP_GUARD, so merchant, customer-authenticated, auth, media and health routes
 * are unaffected (authorization 30039255/B2).
 *
 * Trusted client IP (B4):
 * - trustedProxy 'none' (default; local runs, tests, and any deployment where the API
 *   origin is reachable directly from the internet): the tracker is the socket IP and
 *   every client-sent forwarded header is ignored, so a spoofed header can never mint a
 *   fresh counter identity.
 * - trustedProxy 'vercel': only the leftmost value of x-vercel-forwarded-for is trusted,
 *   because Vercel overwrites that header at its edge with the client IP it observed;
 *   x-forwarded-for is never read. This mode is valid only while the origin cannot be
 *   reached except through Vercel — see docs/ip5/IP5_step9_notes.md.
 * - A missing or malformed header value falls back to the socket IP (fail-closed: the
 *   fallback shares one counter instead of handing out fresh ones).
 * - IPv4 is used as observed; IPv6 is normalized to its /64 subnet so rotating interface
 *   identifiers within a subscriber prefix cannot reset the quota. The key also embeds
 *   the controller and handler names (library generateKey), so each endpoint has an
 *   independent counter per client.
 */
@Injectable()
export class PublicCatalogThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super(options, storage, reflector);
  }

  protected override async getTracker(req: HttpRequestLike): Promise<string> {
    const socketIp = req.socket?.remoteAddress ?? req.ip ?? '';
    if (this.config.publicRateLimit.trustedProxy === 'vercel') {
      const header = req.headers['x-vercel-forwarded-for'];
      const first = (Array.isArray(header) ? header[0] : header)?.split(',')[0]?.trim();
      if (first && isIP(first) !== 0) {
        return normalizeIp(first, this.ipv6SubnetPrefix);
      }
    }
    return normalizeIp(socketIp, this.ipv6SubnetPrefix);
  }
}
