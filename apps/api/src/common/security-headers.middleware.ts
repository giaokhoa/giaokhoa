import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const fullPath = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (fullPath.startsWith('/api/')) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    }
    next();
  }
}


export function attachSecurityHeadersToRawRoutes(
  router: Pick<import('express').Express, 'use'>,
  paths: readonly string[],
): void {
  const middleware = new SecurityHeadersMiddleware();
  for (const path of paths) {
    router.use(path, (req: Request, res: Response, next: NextFunction) =>
      middleware.use(req, res, next),
    );
  }
}
