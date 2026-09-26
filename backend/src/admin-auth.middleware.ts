import { Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('AdminAuth');

/** Constant-time comparison that does not leak the password's length. */
function matches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** The password from an `Authorization: Basic …` header, or null. */
function basicPassword(header: string | undefined): string | null {
  if (!header?.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return colon === -1 ? null : decoded.slice(colon + 1);
}

/**
 * Protect /admin and everything under it with one password, using HTTP Basic
 * auth: the browser shows its own sign-in prompt once and then resends the
 * credentials with the page's API calls, so no login screen or token storage is
 * needed. The username is ignored. The public endpoints — /stream, /station,
 * /health — live outside /admin and are untouched.
 *
 * With no password configured the admin stays open, as it always has, so a
 * deploy can never lock the operator out; importing is refused separately in
 * that case (see ImportService).
 */
export function adminAuth(password: string) {
  if (!password) {
    logger.warn(
      'ADMIN_PASSWORD is not set — /admin is open to anyone and importing is disabled',
    );
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  return (req: Request, res: Response, next: NextFunction) => {
    const given = basicPassword(req.headers.authorization);
    if (given !== null && matches(given, password)) return next();
    res.setHeader(
      'WWW-Authenticate',
      'Basic realm="Station admin", charset="UTF-8"',
    );
    res.status(401).send('Sign in to manage the station.');
  };
}
