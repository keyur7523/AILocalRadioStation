import type { Request, Response } from 'express';
import { adminAuth } from './admin-auth.middleware';

/** Run the middleware once and report what it did. */
function call(
  password: string,
  authorization?: string,
  req: { method?: string; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    headers,
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
    status: (code: number) => {
      res.statusCode = code;
      return res;
    },
    send: jest.fn(),
  };
  const next = jest.fn();
  adminAuth(password)(
    {
      method: req.method ?? 'GET',
      headers: { authorization, ...req.headers },
    } as unknown as Request,
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

describe('adminAuth against other sites', () => {
  const ok = basic('admin', 's3cret');
  const post = (headers: Record<string, string>) =>
    call('s3cret', ok, { method: 'POST', headers });

  it('refuses a change a page on another site submits', () => {
    const { passed, res } = post({ 'sec-fetch-site': 'cross-site' });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(post({ 'sec-fetch-site': 'same-site' }).passed).toBe(false);
  });

  it('falls back to the Origin header for older browsers', () => {
    const host = 'radio.example.com';
    expect(post({ host, origin: 'https://evil.example' }).passed).toBe(false);
    expect(post({ host, origin: 'null' }).passed).toBe(false);
    expect(post({ host, origin: `https://${host}` }).passed).toBe(true);
  });

  it("allows the admin page's own requests and non-browser clients", () => {
    expect(post({ 'sec-fetch-site': 'same-origin' }).passed).toBe(true);
    expect(post({}).passed).toBe(true);
  });

  it('still lets another site link to a page', () => {
    expect(
      call('s3cret', ok, { headers: { 'sec-fetch-site': 'cross-site' } })
        .passed,
    ).toBe(true);
  });

  it('refuses cross-site changes even with no password set', () => {
    expect(
      call('', undefined, {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site' },
      }).passed,
    ).toBe(false);
  });
});
