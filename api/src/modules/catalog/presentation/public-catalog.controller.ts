import { Controller, Get, Param, Query, Req, Res, UseFilters } from '@nestjs/common';
import { Public } from '../../../common/auth/public.decorator';
import { RequestSecurity } from '../../../common/auth/request-security';
import {
  PUBLISHED_CATALOG_CACHE_CONTROL,
  etagFor,
  etagMatches,
} from '../../../common/http/cache-headers';
import { Page, PublicCatalogService, PublicScope } from '../application/public-catalog-service';
import { PublicCategory, PublicProduct } from '../domain/public-catalog-repository';
import { CatalogErrorFilter } from './catalog-error.filter';
import { PublicListQueryDto, PublicProductQueryDto } from './public-catalog.dtos';

interface HttpResponseLike {
  setHeader(name: string, value: string): unknown;
  status(code: number): HttpResponseLike;
  json(body: unknown): unknown;
  end(body?: string): unknown;
}

interface HttpRequestLike {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Public catalog endpoints (IP-5 Step 4; spec 4.2, 6.3, 8.6). @Public: no token is
 * required and the server assigns GUEST visibility; when a Bearer token is supplied it
 * must verify (an invalid or expired token is a 401, never a silent downgrade to Guest).
 * The tenant comes from the URL via TenantResolverGuard; unknown or suspended tenants
 * are a 404 with no detail. Every read is published-only by RLS (GUEST/CUSTOMER public
 * policies), regardless of the caller's token role.
 *
 * M-8 (Step 7): published catalog responses carry `Cache-Control: no-cache` and a
 * strong ETag over the exact representation. A conditional request is answered 304 only
 * AFTER the current representation has been rebuilt through the RLS-backed read — so
 * tenant and publication visibility are always re-evaluated first, and any change to
 * the representation (rename, price, assignment, publish state) changes the ETag. A
 * 304 can therefore never return an obsolete or unauthorized representation (8.6.12).
 */
@Controller('t/:tenantCode')
@Public()
@UseFilters(CatalogErrorFilter)
export class PublicCatalogController {
  constructor(private readonly catalog: PublicCatalogService) {}

  private scope(req: RequestSecurity): PublicScope {
    // tenantId and tenantCode are always set: TenantResolverGuard resolved and validated
    // the URL code before this handler (6.3), so links are built from the verified code.
    return {
      tenantId: req.tenantId as string,
      tenantCode: req.tenantCode as string,
      userId: req.auth?.userId,
    };
  }

  /** Revalidates first, then answers 304 only when the current representation matches. */
  private respond(
    req: HttpRequestLike,
    res: HttpResponseLike,
    body: Page<PublicCategory> | Page<PublicProduct> | PublicProduct,
  ): void {
    const serialized = JSON.stringify(body);
    const etag = etagFor(serialized);
    res.setHeader('Cache-Control', PUBLISHED_CATALOG_CACHE_CONTROL);
    res.setHeader('ETag', etag);
    const inm = req.headers['if-none-match'];
    if (etagMatches(typeof inm === 'string' ? inm : undefined, etag)) {
      res.status(304).end();
      return;
    }
    res.status(200).json(body);
  }

  @Get('categories')
  async listCategories(
    @Req() req: RequestSecurity & HttpRequestLike,
    @Res() res: HttpResponseLike,
    @Query() query: PublicListQueryDto,
  ): Promise<void> {
    const page = await this.catalog.listCategories(this.scope(req), query);
    this.respond(req, res, page);
  }

  @Get('products')
  async listProducts(
    @Req() req: RequestSecurity & HttpRequestLike,
    @Res() res: HttpResponseLike,
    @Query() query: PublicProductQueryDto,
  ): Promise<void> {
    const page = await this.catalog.listProducts(this.scope(req), query);
    this.respond(req, res, page);
  }

  @Get('products/:id')
  async getProduct(
    @Req() req: RequestSecurity & HttpRequestLike,
    @Res() res: HttpResponseLike,
    @Param('id') id: string,
  ): Promise<void> {
    const product = await this.catalog.getProduct(this.scope(req), id);
    this.respond(req, res, product);
  }
}
