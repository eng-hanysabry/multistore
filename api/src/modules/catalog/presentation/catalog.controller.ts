import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseFilters,
} from '@nestjs/common';
import { toSafeError } from '../../../common/errors/safe-error';
import { RequestSecurity } from '../../../common/auth/request-security';
import { Roles } from '../../../common/auth/roles.decorator';
import { CatalogService, MerchantScope, MutationResult } from '../application/catalog-service';
import { CategoryRecord } from '../domain/category-repository';
import { ProductRecord } from '../domain/product-repository';
import { CatalogErrorFilter } from './catalog-error.filter';
import {
  CreateCategoryDto,
  CreateProductDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from './catalog.dtos';

/**
 * Merchant catalog endpoints (IP-5 Step 3; spec 8.6). The global guard chain (6.3) runs
 * before every route: JwtAuthGuard verifies the token, RolesGuard enforces MERCHANT,
 * TenantResolverGuard resolves :tenantCode server-side, MerchantMembershipGuard re-checks
 * membership. tenant_id is never accepted from body, query or headers.
 *
 * Idempotency (10.7): the creating POSTs and publish operations accept an optional
 * Idempotency-Key header; a replay returns the stored first result.
 */
@Controller('t/:tenantCode/merchant')
@Roles('MERCHANT')
@UseFilters(CatalogErrorFilter)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  private scope(req: RequestSecurity): MerchantScope {
    if (!req.auth || !req.tenantId) {
      // unreachable: the global guards ran first; keeps the types narrow without trusting input
      throw new UnauthorizedException(toSafeError('UNAUTHENTICATED', 'Authentication required.'));
    }
    return { tenantId: req.tenantId, userId: req.auth.userId };
  }

  private key(header: string | undefined): string | undefined {
    return typeof header === 'string' && header.length > 0 ? header : undefined;
  }

  @Post('categories')
  async createCategory(
    @Req() req: RequestSecurity,
    @Body() dto: CreateCategoryDto,
    @Headers('idempotency-key') key?: string,
  ): Promise<CategoryRecord> {
    const result = await this.catalog.createCategory(this.scope(req), dto, this.key(key));
    return result.body;
  }

  @Get('categories')
  listCategories(@Req() req: RequestSecurity): Promise<CategoryRecord[]> {
    return this.catalog.listCategories(this.scope(req));
  }

  @Get('categories/:id')
  getCategory(@Req() req: RequestSecurity, @Param('id') id: string): Promise<CategoryRecord> {
    return this.catalog.getCategory(this.scope(req), id);
  }

  @Patch('categories/:id')
  updateCategory(
    @Req() req: RequestSecurity,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryRecord> {
    return this.catalog.updateCategory(this.scope(req), id, dto);
  }

  @Post('categories/:id/publish')
  @HttpCode(200)
  async publishCategory(
    @Req() req: RequestSecurity,
    @Param('id') id: string,
    @Headers('idempotency-key') key?: string,
  ): Promise<CategoryRecord> {
    const result = await this.catalog.publishCategory(this.scope(req), id, this.key(key));
    return result.body;
  }

  @Post('categories/:id/unpublish')
  @HttpCode(200)
  unpublishCategory(@Req() req: RequestSecurity, @Param('id') id: string): Promise<CategoryRecord> {
    return this.catalog.unpublishCategory(this.scope(req), id);
  }

  @Delete('categories/:id')
  @HttpCode(204)
  async deleteCategory(@Req() req: RequestSecurity, @Param('id') id: string): Promise<void> {
    await this.catalog.deleteCategory(this.scope(req), id);
  }

  @Post('products')
  async createProduct(
    @Req() req: RequestSecurity,
    @Body() dto: CreateProductDto,
    @Headers('idempotency-key') key?: string,
  ): Promise<ProductRecord> {
    const result: MutationResult<ProductRecord> = await this.catalog.createProduct(
      this.scope(req),
      dto,
      this.key(key),
    );
    return result.body;
  }

  @Get('products')
  listProducts(@Req() req: RequestSecurity): Promise<ProductRecord[]> {
    return this.catalog.listProducts(this.scope(req));
  }

  @Get('products/:id')
  getProduct(@Req() req: RequestSecurity, @Param('id') id: string): Promise<ProductRecord> {
    return this.catalog.getProduct(this.scope(req), id);
  }

  @Patch('products/:id')
  updateProduct(
    @Req() req: RequestSecurity,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductRecord> {
    return this.catalog.updateProduct(this.scope(req), id, dto);
  }

  @Post('products/:id/publish')
  @HttpCode(200)
  async publishProduct(
    @Req() req: RequestSecurity,
    @Param('id') id: string,
    @Headers('idempotency-key') key?: string,
  ): Promise<ProductRecord> {
    const result = await this.catalog.publishProduct(this.scope(req), id, this.key(key));
    return result.body;
  }

  @Post('products/:id/unpublish')
  @HttpCode(200)
  unpublishProduct(@Req() req: RequestSecurity, @Param('id') id: string): Promise<ProductRecord> {
    return this.catalog.unpublishProduct(this.scope(req), id);
  }

  @Delete('products/:id')
  @HttpCode(204)
  async deleteProduct(@Req() req: RequestSecurity, @Param('id') id: string): Promise<void> {
    await this.catalog.deleteProduct(this.scope(req), id);
  }
}
