import { Controller, Get, Param, Query, Req, Res, UseFilters } from '@nestjs/common';
import { Public } from '../../../common/auth/public.decorator';
import { RequestSecurity } from '../../../common/auth/request-security';
import { MediaService, ServingScope } from '../application/media-service';
import { ImageVariant } from '../domain/media-rules';
import { MediaErrorFilter } from './media-error.filter';
import { ImageQueryDto } from './media.dtos';

interface HttpResponseLike {
  setHeader(name: string, value: string): unknown;
  status(code: number): HttpResponseLike;
  end(body?: Buffer): unknown;
}

/** Spec 7 / M-8: published image variants are cacheable for at most 60 seconds. */
export const PUBLISHED_IMAGE_CACHE_CONTROL = 'public, max-age=60';
/** M-8: draft and authorization-dependent content is never stored by any cache. */
export const PRIVATE_CACHE_CONTROL = 'private, no-store';

/**
 * Authorized image serving (IP-5 Step 6; spec 7: published product images only through
 * the backend API). @Public: no token is required; a supplied token must still verify
 * (an invalid or expired one is a 401, never a silent downgrade). Every request runs
 * the serving query under the caller's own RLS context, so tenant, product publication
 * state and role are checked on each request — a cached representation can never widen
 * access (8.6.12): published bytes carry max-age=60 and everything else is no-store.
 * The response is raw image bytes; no storage key, URL or provider field ever appears.
 */
@Controller('t/:tenantCode/products/:productId/media')
@Public()
@UseFilters(MediaErrorFilter)
export class MediaImageController {
  constructor(private readonly media: MediaService) {}

  private scope(req: RequestSecurity): ServingScope {
    return {
      tenantId: req.tenantId as string, // always set: TenantResolverGuard ran first (6.3)
      userId: req.auth?.userId,
      role: req.auth?.role === 'GUEST' ? undefined : req.auth?.role,
    };
  }

  @Get(':mediaId/image')
  async serve(
    @Req() req: RequestSecurity,
    @Res() res: HttpResponseLike,
    @Param('productId') productId: string,
    @Param('mediaId') mediaId: string,
    @Query() query: ImageQueryDto,
  ): Promise<void> {
    const variant: ImageVariant = query.size ?? 'display';
    const image = await this.media.serve(this.scope(req), productId, mediaId, variant);
    res.setHeader('Content-Type', image.contentType);
    res.setHeader(
      'Cache-Control',
      image.visibility === 'public' ? PUBLISHED_IMAGE_CACHE_CONTROL : PRIVATE_CACHE_CONTROL,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).end(Buffer.from(image.bytes));
  }
}
