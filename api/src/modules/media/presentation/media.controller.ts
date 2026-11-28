import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { toSafeError } from '../../../common/errors/safe-error';
import { PrivateNoStoreInterceptor } from '../../../common/http/private-no-store.interceptor';
import { RequestSecurity } from '../../../common/auth/request-security';
import { Roles } from '../../../common/auth/roles.decorator';
import {
  MediaService,
  MediaView,
  MerchantScope,
  MutationResult,
} from '../application/media-service';
import { MAX_UPLOAD_BYTES } from '../domain/media-rules';
import { MediaError } from '../domain/media-errors';
import { MediaErrorFilter } from './media-error.filter';
import { PayloadTooLargeFilter } from './payload-too-large.filter';

/** Structural shape of a parsed multipart file (multer memory storage). */
interface UploadedMultipartFile {
  readonly buffer: Buffer;
  readonly originalname: string;
  readonly size: number;
}

export interface MediaResponse extends MediaView {
  /** The API's own image URL (spec 7: the only URL a client ever receives). */
  readonly imageUrl: string;
}

/**
 * Merchant media endpoints (IP-5 Step 6; spec 7, 8.6.9, 10.7). The global guard chain
 * (6.3) runs before every route: verified token, MERCHANT role, server-side URL tenant
 * resolution, membership re-check. tenant_id is never accepted from body, query or
 * headers; client filenames and client-supplied storage references are never trusted
 * (the filename is stored as metadata only, and object keys are server-generated).
 *
 * The 5 MB intake cap is enforced twice: multer rejects the multipart stream at the
 * limit (bounded memory: the file buffer can never exceed it) and the domain re-checks
 * the decoded input. Upload and delete accept an optional Idempotency-Key (G.7).
 */
@Controller('t/:tenantCode/merchant/products/:productId/media')
@Roles('MERCHANT')
@UseFilters(MediaErrorFilter, PayloadTooLargeFilter)
@UseInterceptors(PrivateNoStoreInterceptor)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  private scope(req: RequestSecurity): MerchantScope {
    if (!req.auth || !req.tenantId) {
      // unreachable: the global guards ran first; keeps the types narrow without trusting input
      throw new UnauthorizedException(toSafeError('UNAUTHENTICATED', 'Authentication required.'));
    }
    return { tenantId: req.tenantId, userId: req.auth.userId };
  }

  private respond(req: RequestSecurity, productId: string, view: MediaView): MediaResponse {
    return { ...view, imageUrl: this.imageUrl(req, productId, view.id) };
  }

  private imageUrl(req: RequestSecurity, productId: string, mediaId: string): string {
    return `/t/${req.tenantCode ?? ''}/products/${productId}/media/${mediaId}/image`;
  }

  private fileOf(file: UploadedMultipartFile | undefined): {
    bytes: Uint8Array;
    originalFilename?: string;
  } {
    if (!file || file.buffer === undefined) throw new MediaError('VALIDATION');
    return { bytes: new Uint8Array(file.buffer), originalFilename: file.originalname };
  }

  private key(header: string | undefined): string | undefined {
    return typeof header === 'string' && header.length > 0 ? header : undefined;
  }

  /**
   * Multipart text fields get no DTO whitelist (the pipe only validates DTO metatypes),
   * so tenant/storage fields are rejected explicitly (6.3): tenant_id is never accepted
   * from a request body in any encoding.
   */
  private assertNoSmuggledFields(body: Record<string, unknown> | undefined): void {
    if (!body || typeof body !== 'object') return;
    for (const k of Object.keys(body)) {
      const key = k.toLowerCase();
      if (key.includes('tenant') || key.includes('drive') || key.includes('storage'))
        throw new MediaError('VALIDATION');
    }
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async upload(
    @Req() req: RequestSecurity,
    @Param('productId') productId: string,
    @UploadedFile() file: UploadedMultipartFile,
    @Body() fields: Record<string, unknown>,
    @Headers('idempotency-key') key?: string,
  ): Promise<MediaResponse> {
    this.assertNoSmuggledFields(fields);
    const result: MutationResult<MediaView> = await this.media.upload(
      this.scope(req),
      productId,
      this.fileOf(file),
      this.key(key),
    );
    return this.respond(req, productId, result.body);
  }

  @Get()
  async list(
    @Req() req: RequestSecurity,
    @Param('productId') productId: string,
  ): Promise<MediaResponse[]> {
    const views = await this.media.list(this.scope(req), productId);
    return views.map((v) => this.respond(req, productId, v));
  }

  @Post(':mediaId/replace')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async replace(
    @Req() req: RequestSecurity,
    @Param('productId') productId: string,
    @Param('mediaId') mediaId: string,
    @UploadedFile() file: UploadedMultipartFile,
    @Body() fields: Record<string, unknown>,
  ): Promise<MediaResponse> {
    this.assertNoSmuggledFields(fields);
    const view = await this.media.replace(this.scope(req), productId, mediaId, this.fileOf(file));
    return this.respond(req, productId, view);
  }

  @Delete(':mediaId')
  @HttpCode(204)
  async remove(
    @Req() req: RequestSecurity,
    @Param('productId') productId: string,
    @Param('mediaId') mediaId: string,
    @Headers('idempotency-key') key?: string,
  ): Promise<void> {
    await this.media.deleteMedia(this.scope(req), productId, mediaId, this.key(key));
  }
}
