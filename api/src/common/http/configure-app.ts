import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

interface Req {
  url?: string;
}
interface Res {
  headersSent: boolean;
  statusCode: number;
  setHeader(n: string, v: string): unknown;
  end(body?: string): unknown;
}

export const REQUEST_TIMEOUT_MS = 15_000; // 10.7: HTTP request timeout, then 503

/** Cross-cutting HTTP setup: secure headers (D1, helmet) and the 15 s request timeout (10.7). */
export function configureApp(app: INestApplication, requestTimeoutMs = REQUEST_TIMEOUT_MS): void {
  app.use(helmet());
  // Spec 5.4: DTO whitelist; unknown fields (including any tenant value outside the URL) rejected.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.use((_req: Req, res: Res, next: () => void) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.statusCode = 503;
        res.setHeader('Retry-After', '5');
        res.setHeader('Content-Type', 'application/json');
        res.end(
          '{"error":{"code":"REQUEST_TIMEOUT","message":"The server took too long. Try again."}}',
        );
      }
    }, requestTimeoutMs);
    timer.unref();
    (res as unknown as { on(e: string, f: () => void): void }).on('finish', () =>
      clearTimeout(timer),
    );
    next();
  });
}
