import { describe, expect, it, vi } from 'vitest';
import { S3Backend } from './s3.ts';
import type { S3BackendOptions } from './s3.ts';

const OPTS: S3BackendOptions = {
  bucket: 'nx-cache',
  region: 'auto',
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  credentials: { accessKeyId: 'AKID', secretAccessKey: 'secret' },
};

function mockFetch(handler: (url: string, init: RequestInit) => Response): typeof fetch {
  return vi.fn((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    Promise.resolve(handler(String(input), init ?? {})),
  ) as unknown as typeof fetch;
}

describe('S3Backend', () => {
  it('PUTs to <endpoint>/<bucket>/<prefix>/<key> with If-None-Match and meta sha256', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = mockFetch((url, init) => {
      seen = { url, init };
      return new Response(null, { status: 200 });
    });
    const b = new S3Backend({ ...OPTS, prefix: 'nx', fetchImpl });
    const res = await b.putIfAbsent('main/h1', Buffer.from('body'), 'deadbeef');
    expect(res).toBe('created');
    expect(seen!.url).toBe('https://acct.r2.cloudflarestorage.com/nx-cache/nx/main/h1');
    const headers = new Headers(seen!.init.headers);
    expect(headers.get('if-none-match')).toBe('*');
    expect(headers.get('x-amz-meta-sha256')).toBe('deadbeef');
    expect(headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it('maps 412 Precondition Failed to conflict', async () => {
    const fetchImpl = mockFetch(() => new Response(null, { status: 412 }));
    const b = new S3Backend({ ...OPTS, fetchImpl });
    expect(await b.putIfAbsent('main/h1', Buffer.from('x'), 's')).toBe('conflict');
  });

  it('GETs and returns body + stored sha256 metadata', async () => {
    const fetchImpl = mockFetch(
      () =>
        new Response('artifact', {
          status: 200,
          headers: { 'x-amz-meta-sha256': 'cafe' },
        }),
    );
    const b = new S3Backend({ ...OPTS, fetchImpl });
    const got = await b.get('main/h1');
    expect(got).not.toBeNull();
    expect(got!.body.toString()).toBe('artifact');
    expect(got!.sha256).toBe('cafe');
  });

  it('returns null on 404', async () => {
    const fetchImpl = mockFetch(() => new Response(null, { status: 404 }));
    const b = new S3Backend({ ...OPTS, fetchImpl });
    expect(await b.get('main/nope')).toBeNull();
  });

  it('throws on unexpected statuses (fail loud)', async () => {
    const fetchImpl = mockFetch(() => new Response('denied', { status: 403 }));
    const b = new S3Backend({ ...OPTS, fetchImpl });
    await expect(b.get('main/h1')).rejects.toThrow(/403/);
    await expect(b.putIfAbsent('main/h1', Buffer.from('x'), 's')).rejects.toThrow(/403/);
  });

  it('uses virtual-hosted style when no endpoint is given', async () => {
    let url = '';
    const fetchImpl = mockFetch((u) => {
      url = u;
      return new Response('ok', { status: 200 });
    });
    const b = new S3Backend({
      bucket: 'bkt',
      region: 'eu-west-1',
      credentials: OPTS.credentials,
      fetchImpl,
    });
    await b.get('main/h1');
    expect(url).toBe('https://bkt.s3.eu-west-1.amazonaws.com/main/h1');
  });
});
