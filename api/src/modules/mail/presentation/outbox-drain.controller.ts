import { timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../../common/auth/public.decorator';
import { AppConfig } from '../../../common/config/app-config';
import { APP_CONFIG } from '../../../common/config/config.token';
import { OutboxWorker } from '../application/outbox-worker';

/** Longest a single sweep runs, below the platform function limit. */
export const DRAIN_BUDGET_MS = 45_000;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Scheduled retry (spec 10.3, serverless host). Not part of the public contract. Only a caller
 * holding CRON_SECRET may run it; the response carries counts only, never message data.
 */
// @Public(): it authenticates with CRON_SECRET below, not with a user JWT.
@Public()
@Controller('internal/outbox')
@ApiExcludeController()
export class OutboxDrainController {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(OutboxWorker) private readonly worker: OutboxWorker,
  ) {}

  @Post('drain')
  @HttpCode(200)
  async drain(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<{ sent: number; passes: number }> {
    const secret = this.cfg.cronSecret;
    if (!secret) throw new NotFoundException(); // endpoint does not exist unless configured
    const given = /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
    if (!given || !safeEqual(given, secret)) throw new UnauthorizedException();

    const deadline = Date.now() + DRAIN_BUDGET_MS;
    let sent = 0;
    let passes = 0;
    while (Date.now() < deadline) {
      passes += 1;
      const n = await this.worker.tick();
      sent += n;
      if (n === 0) break; // nothing more is due right now
    }
    return { sent, passes };
  }
}
