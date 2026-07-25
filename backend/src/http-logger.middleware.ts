import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

/**
 * Log every HTTP request once its response finishes (method, path, status,
 * duration). Emitted at `verbose` so it's on by default but easy to silence via
 * LOG_LEVELS. For `/stream` (a long-lived connection) "finish" fires when the
 * listener disconnects, so the duration is how long they were tuned in.
 */
export function httpLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();
  res.on('finish', () => {
    logger.verbose(
      `${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`,
    );
  });
  next();
}
