import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { IMAGE_VARIANTS, ImageVariant } from '../domain/media-rules';

/**
 * Image serving query. The whitelist pipe rejects every unknown parameter — including
 * any tenant value outside the URL (6.3). size selects the logical variant only; object
 * keys are resolved server-side from the media row and never taken from the client.
 */
export class ImageQueryDto {
  @ApiPropertyOptional({
    enum: [...IMAGE_VARIANTS],
    default: 'display',
    description:
      'Image variant to serve. `display` (default) is the WebP rendition capped at 1024 px, ' +
      '`thumb` the one capped at 256 px, and `original` the full-size rendition after EXIF ' +
      'orientation correction, re-encoded to WebP (not a byte-for-byte copy of the upload).',
  })
  @IsOptional()
  @IsIn(IMAGE_VARIANTS as readonly string[])
  size?: ImageVariant;
}
