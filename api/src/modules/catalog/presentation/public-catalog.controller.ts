import { Controller, Get, Param, Query, Req, UseFilters } from '@nestjs/common';
import { Public } from '../../../common/auth/public.decorator';
import { RequestSecurity } from '../../../common/auth/request-security';
import { Page, PublicCatalogService, PublicScope } from '../application/public-catalog-service';
import { PublicCategory, PublicProduct } from '../domain/public-catalog-repository';
import { CatalogErrorFilter } from './catalog-error.filter';
import { PublicListQueryDto, PublicProductQueryDto } from './public-catalog.dtos';

/**
 * Public catalog endpoints (IP-5 Step 4; spec 4.2, 6.3, 8.6). @Public: no token is
 * required and the server assigns GUEST visibility; when a Bearer token is supplied it
 * must verify (an invalid or expired token is a 401, never a silent downgrade to Guest).
 * The tenant comes from the URL via TenantResolverGuard; unknown or suspended tenants
 * are a 404 with no detail. Every read is published-only by RLS (GUEST/CUSTOMER public
 * policies), regardless of the caller's token role.
 */
@Controller('t/:tenantCode')
@Public()
@UseFilters(CatalogErrorFilter)
export class PublicCatalogController {
  constructor(private readonly catalog: PublicCatalogService) {}

  private scope(req: RequestSecurity): PublicScope {
    // tenantId is always set: TenantResolverGuard ran before this handler (6.3).
    return { tenantId: req.tenantId as string, userId: req.auth?.userId };
  }

  @Get('categories')
  listCategories(
    @Req() req: RequestSecurity,
    @Query() query: PublicListQueryDto,
  ): Promise<Page<PublicCategory>> {
    return this.catalog.listCategories(this.scope(req), query);
  }

  @Get('products')
  listProducts(
    @Req() req: RequestSecurity,
    @Query() query: PublicProductQueryDto,
  ): Promise<Page<PublicProduct>> {
    return this.catalog.listProducts(this.scope(req), query);
  }

  @Get('products/:id')
  getProduct(@Req() req: RequestSecurity, @Param('id') id: string): Promise<PublicProduct> {
    return this.catalog.getProduct(this.scope(req), id);
  }
}
