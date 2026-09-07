import { AwsClient } from 'aws4fetch';

/** One object in the bucket. */
export interface RemoteObject {
  key: string;
  size: number;
}

/**
 * A minimal S3 client for Cloudflare R2 — list, get, put, and nothing else.
 *
 * Deliberately not the AWS SDK. That pulls in ~11 MB and costs ~25 MB of RSS
 * just to import, against ~1 MB here; on a 512 MB host already sharing memory
 * with a neural speech model, that headroom is worth more than the SDK's
 * breadth. We only ever make three calls, so the surface we hand-roll is small:
 * signing is left to aws4fetch, and only the ListObjectsV2 response needs
 * parsing.
 */
export class R2Client {
  private readonly aws: AwsClient;
  private readonly base: string;

  constructor(
    accountId: string,
    private readonly bucket: string,
    accessKeyId: string,
    secretAccessKey: string,
    /**
     * Override the S3 endpoint. Defaults to R2's; set it to point at another
     * S3-compatible provider, or at a local server to exercise this client
     * against a real implementation rather than a mock.
     */
    endpoint?: string,
  ) {
    this.aws = new AwsClient({
      accessKeyId,
      secretAccessKey,
      service: 's3',
      // R2 ignores the region but SigV4 requires one; "auto" is what
      // Cloudflare's own examples use.
      region: 'auto',
    });
    const origin =
      endpoint?.replace(/\/+$/, '') ??
      `https://${accountId}.r2.cloudflarestorage.com`;
    this.base = `${origin}/${bucket}`;
  }

  /** Every object in the bucket, following pagination to the end. */
  async list(): Promise<RemoteObject[]> {
    const objects: RemoteObject[] = [];
    let token: string | undefined;
    do {
      const url = new URL(this.base);
      url.searchParams.set('list-type', '2');
      if (token) url.searchParams.set('continuation-token', token);
      const res = await this.aws.fetch(url.toString());
      if (!res.ok) {
        throw new Error(`list failed: HTTP ${res.status} ${await res.text()}`);
      }
      const xml = await res.text();
      objects.push(...parseContents(xml));
      token = tagValue(xml, 'NextContinuationToken');
    } while (token);
    return objects;
  }

  /** Download one object's bytes. */
  async get(key: string): Promise<Buffer> {
    const res = await this.aws.fetch(`${this.base}/${encodeURIComponent(key)}`);
    if (!res.ok) {
      throw new Error(`get "${key}" failed: HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /** Upload one object. */
  async put(
    key: string,
    body: Buffer,
    contentType = 'audio/mpeg',
  ): Promise<void> {
    const res = await this.aws.fetch(
      `${this.base}/${encodeURIComponent(key)}`,
      {
        method: 'PUT',
        body: new Uint8Array(body),
        headers: { 'Content-Type': contentType },
      },
    );
    if (!res.ok) {
      throw new Error(
        `put "${key}" failed: HTTP ${res.status} ${await res.text()}`,
      );
    }
  }
}

/** Pull `<Contents>` entries out of a ListObjectsV2 response. */
function parseContents(xml: string): RemoteObject[] {
  const out: RemoteObject[] = [];
  const blocks = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? [];
  for (const block of blocks) {
    const key = tagValue(block, 'Key');
    if (!key) continue;
    out.push({ key, size: Number(tagValue(block, 'Size') ?? 0) });
  }
  return out;
}

/** The text of the first `<tag>` in `xml`, with XML entities decoded. */
function tagValue(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? decodeEntities(match[1]) : undefined;
}

/**
 * Object keys arrive XML-escaped, so a file with an ampersand in its name comes
 * back as `&amp;` and would otherwise never match the file on disk.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
