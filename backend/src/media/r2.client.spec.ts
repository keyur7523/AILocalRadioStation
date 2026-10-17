import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { R2Client } from './r2.client';

/** A stand-in bucket: serves and stores objects in memory. */
describe('R2Client transfers', () => {
  const objects = new Map<string, Buffer>();
  const auth: string[] = [];
  let server: Server;
  let client: R2Client;
  let dir: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      auth.push(req.headers.authorization ?? '');
      const key = decodeURIComponent(req.url!.replace('/bucket/', ''));
      if (req.method === 'PUT') {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          objects.set(key, Buffer.concat(chunks));
          res.end();
        });
        return;
      }
      const body = objects.get(key);
      res.statusCode = body ? 200 : 404;
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    client = new R2Client(
      '',
      'bucket',
      'id',
      'secret',
      `http://127.0.0.1:${port}`,
    );
    dir = await mkdtemp(join(tmpdir(), 'r2-spec-'));
  });

  afterAll(async () => {
    server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('uploads exactly the bytes given, signed', async () => {
    // Small Buffers share a pooled allocation, so they start at an offset.
    const small = Buffer.from('tiny track');
    expect(small.byteOffset).toBeGreaterThan(0);
    await client.put('uploads/a.mp3', small);
    expect(objects.get('uploads/a.mp3')?.toString()).toBe('tiny track');
    expect(auth.at(-1)).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it('streams a download to disk and reports its size', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 7);
    objects.set('rock/b.mp3', big);
    const path = join(dir, 'b.mp3');
    expect(await client.download('rock/b.mp3', path)).toBe(big.length);
    expect((await readFile(path)).equals(big)).toBe(true);
  });

  it('fails clearly on a missing object', async () => {
    await expect(client.download('nope.mp3', join(dir, 'x'))).rejects.toThrow(
      /HTTP 404/,
    );
  });
});
