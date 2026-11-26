import { Controller, Get, Inject, Res } from '@nestjs/common';
import { Public } from '../../../common/auth/public.decorator';
import { HealthService } from '../application/health.service';

interface ResponseLike {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get('live')
  live(): ReturnType<HealthService['live']> {
    return this.health.live();
  }

  @Get('ready')
  async ready(
    @Res({ passthrough: true }) res: ResponseLike,
  ): Promise<Awaited<ReturnType<HealthService['ready']>>> {
    const body = await this.health.ready();
    if (body.status !== 'ready') {
      res.status(503);
      res.setHeader('Retry-After', '5');
    }
    return body;
  }
}
