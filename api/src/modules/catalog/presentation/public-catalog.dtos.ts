import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/**
 * Public catalog query parameters. The whitelist pipe rejects every unknown parameter —
 * including any tenant value outside the URL (6.3). Limit and query-length caps are the
 * approved ones (page size max 50, query max 100 characters); cursor shape is validated
 * strictly in the domain layer.
 */
export class PublicListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  cursor?: string;
}

export class PublicProductQueryDto extends PublicListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
