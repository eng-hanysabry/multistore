import { IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';

/**
 * Merchant catalog request bodies. Unknown fields are rejected by the global whitelist
 * pipe (spec 5.4) — tenant_id can never arrive in a body (6.3). status is deliberately
 * absent everywhere: product/category status is server-controlled (Batch 1 section 13).
 */

export class CreateCategoryDto {
  @IsString()
  @Length(1, 120)
  name!: string;
}

export class UpdateCategoryDto {
  @IsString()
  @Length(1, 120)
  name!: string;
}

export class CreateProductDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  priceAmount?: number;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'priceCurrency must be an ISO 4217 code' })
  priceCurrency?: string;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  priceAmount?: number;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'priceCurrency must be an ISO 4217 code' })
  priceCurrency?: string;
}
