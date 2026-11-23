import { createHash } from 'node:crypto';

export type StoreResult = 'stored' | 'conflict';

/**
 * Spec-conformant client for the Nx remote-cache HTTP contract —
 * the same wire protocol `NX_SELF_HOSTED_REMOTE_CACHE_SERVER` uses.
 * Useful for smoke tests, cache inspection, and conformance checks.
 */
export class RemoteCacheClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch) {
    let url = baseUrl;
    while (url.endsWith('/')) url = url.slice(0, -1);
    this.baseUrl = url;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  private url(hash: string): string {
    return `${this.baseUrl}/v1/cache/${encodeURIComponent(hash)}`;
  }

  /**
   * PUT /v1/cache/{hash}. Returns 'stored' on success, 'conflict' when
   * the artifact already exists (immutable cache — never an overwrite).
   */
  async store(hash: string, body: Buffer | Uint8Array): Promise<StoreResult> {
    const res = await this.fetchImpl(this.url(hash), {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/octet-stream',
        'content-length': String(body.byteLength),
      },
      body,
    });
    if (res.status === 409) return 'conflict';
    if (res.status === 200) return 'stored';
    throw new Error(`cache store failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  }

  /**
   * GET /v1/cache/{hash}. Returns the artifact bytes, or null on a miss.
   * When the server sends `X-Cache-Sha256`, the payload is verified and a
   * mismatch throws — a corrupted artifact is never handed back.
   */
  async retrieve(hash: string): Promise<Buffer | null> {
    const res = await this.fetchImpl(this.url(hash), {
      method: 'GET',
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(
        `cache retrieve failed: HTTP ${res.status} ${await res.text().catch(() => '')}`,
      );
    }
    const body = Buffer.from(await res.arrayBuffer());
    const announced = res.headers.get('x-cache-sha256');
    if (announced !== null) {
      const actual = createHash('sha256').update(body).digest('hex');
      if (actual !== announced) {
        throw new Error(
          `artifact integrity check failed: sha256 ${actual} != announced ${announced}`,
        );
      }
    }
    return body;
  }
}
