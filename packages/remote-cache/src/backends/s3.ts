import { signRequest, sha256Hex } from '../sigv4.ts';
import type { SigV4Credentials } from '../sigv4.ts';
import type { CacheBackend, PutResult, StoredArtifact } from './types.ts';

// SigV4 canonical URIs need strict RFC 3986 encoding — encodeURIComponent
// leaves ! ' ( ) * unescaped and AWS rejects the signature for such keys.
const uriEncode = (s: string): string =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export interface S3BackendOptions {
  bucket: string;
  /** AWS region; use 'auto' for Cloudflare R2. */
  region?: string;
  /**
   * Custom endpoint (R2, MinIO, LocalStack, …). When set, requests use
   * path-style `<endpoint>/<bucket>/<key>`; otherwise virtual-hosted
   * `https://<bucket>.s3.<region>.amazonaws.com/<key>`.
   */
  endpoint?: string;
  /** Key prefix applied to every artifact key. */
  prefix?: string;
  credentials: SigV4Credentials;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * S3/R2 backend — the primary deployment target.
 *
 * Immutability rides on S3 conditional writes: `If-None-Match: *` on
 * PutObject makes the write fail with 412 PreconditionFailed when the key
 * already exists — atomic create-only semantics, supported by AWS S3
 * (since 2024) and Cloudflare R2.
 *
 * The artifact's sha256 is recorded in `x-amz-meta-sha256` object
 * metadata and verified on read by the server.
 */
export class S3Backend implements CacheBackend {
  private readonly opts: S3BackendOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: S3BackendOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private urlFor(key: string): { url: string; host: string; path: string } {
    const objectKey = this.opts.prefix ? `${this.opts.prefix}/${key}` : key;
    const encoded = objectKey.split('/').map(uriEncode).join('/');
    if (this.opts.endpoint !== undefined) {
      let endpoint = this.opts.endpoint;
      while (endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);
      const ep = new URL(endpoint);
      const host = ep.host;
      // An endpoint path prefix (MinIO behind /s3, a reverse proxy base)
      // belongs in the signed canonical URI too — not just the wire URL.
      const basePath = ep.pathname.replace(/\/+$/, '');
      const objectPath = `/${uriEncode(this.opts.bucket)}/${encoded}`;
      return { url: `${endpoint}${objectPath}`, host, path: `${basePath}${objectPath}` };
    }
    const region = this.opts.region ?? 'us-east-1';
    const host = `${this.opts.bucket}.s3.${region}.amazonaws.com`;
    return { url: `https://${host}/${encoded}`, host, path: `/${encoded}` };
  }

  private signedHeaders(
    method: string,
    host: string,
    path: string,
    extra: Record<string, string>,
    payloadHash: string,
  ): Record<string, string> {
    return signRequest({
      method,
      host,
      path,
      query: '',
      region: this.opts.region ?? 'us-east-1',
      service: 's3',
      headers: extra,
      payloadHash,
      credentials: this.opts.credentials,
    });
  }

  async putIfAbsent(key: string, body: Buffer, sha256: string): Promise<PutResult> {
    const { url, host, path } = this.urlFor(key);
    const headers = this.signedHeaders(
      'PUT',
      host,
      path,
      {
        'content-length': String(body.byteLength),
        'content-type': 'application/octet-stream',
        'if-none-match': '*',
        'x-amz-meta-sha256': sha256,
      },
      sha256Hex(body),
    );

    const res = await this.fetchImpl(url, { method: 'PUT', headers, body });
    // 412 PreconditionFailed for If-None-Match; 409 ConditionalRequestConflict
    // is the racing-writes flavour — both mean the key already exists.
    if (res.status === 412 || res.status === 409) return 'conflict';
    if (res.status >= 200 && res.status < 300) return 'created';
    const detail = await res.text().catch(() => '');
    throw new Error(`S3 PUT ${key} failed: HTTP ${res.status} ${detail}`);
  }

  async get(key: string): Promise<StoredArtifact | null> {
    const { url, host, path } = this.urlFor(key);
    const headers = this.signedHeaders(
      'GET',
      host,
      path,
      {},
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );

    const res = await this.fetchImpl(url, { method: 'GET', headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`S3 GET ${key} failed: HTTP ${res.status} ${detail}`);
    }
    const body = Buffer.from(await res.arrayBuffer());
    return { body, sha256: res.headers.get('x-amz-meta-sha256') };
  }
}
