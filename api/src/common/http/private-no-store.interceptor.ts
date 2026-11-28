import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PRIVATE_CACHE_CONTROL } from './cache-headers';

interface HttpResponseLike {
  setHeader(name: string, value: string): unknown;
}

/**
 * M-8: every merchant (authorization-dependent) JSON response carries
 * `Cache-Control: private, no-store` — draft and private catalog/media data must never
 * be stored by any cache (8.6.12). Applied at the merchant controllers.
 */
@Injectable()
export class PrivateNoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<HttpResponseLike>();
    res.setHeader('Cache-Control', PRIVATE_CACHE_CONTROL);
    return next.handle().pipe(tap(() => undefined));
  }
}
