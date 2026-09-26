import type { NextFunction, Request, Response } from 'express';
import { adminAuth } from './admin-auth.middleware';

/** Run the middleware once and report what it did. */
function call(password: string, authorization?: string) {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send: jest.fn(),
  };
  const next = jest.fn();
  adminAuth(password)(
    { headers: { authorization } } as unknown as Request,
    res as unknown as Response,
    next,
  );
  return { passed: next.mock.calls.length === 1, res };
}

const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

describe('adminAuth', () => {
  it('asks for credentials when none are sent', () => {
    const { passed, res } = call('s3cret');
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Basic /);
  });

  it('refuses a wrong password', () => {
    expect(call('s3cret', basic('admin', 'guess')).passed).toBe(false);
    expect(call('s3cret', basic('admin', 's3cret ')).passed).toBe(false);
  });

  it('lets the right password through, whatever the username', () => {
    expect(call('s3cret', basic('admin', 's3cret')).passed).toBe(true);
    expect(call('s3cret', basic('', 's3cret')).passed).toBe(true);
  });

  it('keeps a password containing a colon intact', () => {
    expect(call('a:b:c', basic('admin', 'a:b:c')).passed).toBe(true);
  });

  it('ignores other authorization schemes', () => {
    expect(call('s3cret', 'Bearer s3cret').passed).toBe(false);
  });

  it('stays open when no password is configured', () => {
    expect(call('').passed).toBe(true);
  });
});
