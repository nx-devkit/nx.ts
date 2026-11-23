import { createHmac, createHash } from 'node:crypto';

/**
 * Minimal AWS Signature Version 4 signer — enough for S3/R2 object
 * operations without pulling in the AWS SDK. Implements the canonical
 * request / string-to-sign / signing-key chain per
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
 */

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SignRequestOptions {
  method: string;
  host: string;
  /** URI-encoded absolute path, e.g. `/bucket/key`. */
  path: string;
  /** Canonical query string (already encoded & sorted), '' when none. */
  query: string;
  region: string;
  service: string;
  /** Extra headers to include in the signature (host and x-amz-date are added). */
  headers: Record<string, string>;
  /** Hex sha256 of the payload, or 'UNSIGNED-PAYLOAD'. */
  payloadHash: string;
  credentials: SigV4Credentials;
  now?: Date;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function amzDate(now: Date): { dateTime: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  return { dateTime: iso, dateStamp: iso.slice(0, 8) };
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Returns the full header set to send: the caller's headers plus
 * `host`, `X-Amz-Date`, `x-amz-content-sha256`, `Authorization`, and
 * `x-amz-security-token` when a session token is present.
 */
export function signRequest(opts: SignRequestOptions): Record<string, string> {
  const now = opts.now ?? new Date();
  const { dateTime, dateStamp } = amzDate(now);

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers)) headers[k.toLowerCase()] = v;
  // A caller-supplied Authorization would collide with the signed one
  // appended below (duplicate headers, differing only by case).
  delete headers['authorization'];
  headers['host'] = opts.host;
  headers['x-amz-date'] = dateTime;
  // S3 requires the payload-hash header; other services (e.g. the IAM
  // doc example) do not send it, so only add it for s3.
  if (opts.service === 's3') headers['x-amz-content-sha256'] = opts.payloadHash;
  if (opts.credentials.sessionToken !== undefined) {
    headers['x-amz-security-token'] = opts.credentials.sessionToken;
  }

  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames
    .map((name) => `${name}:${headers[name]!.trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const canonicalRequest = [
    opts.method,
    opts.path,
    opts.query,
    canonicalHeaders,
    signedNames.join(';'),
    opts.payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', dateTime, scope, sha256Hex(canonicalRequest)].join(
    '\n',
  );

  const kDate = hmac(`AWS4${opts.credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, opts.region);
  const kService = hmac(kRegion, opts.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const out: Record<string, string> = {};
  for (const name of signedNames) if (name !== 'x-amz-date') out[name] = headers[name]!;
  out['X-Amz-Date'] = dateTime;
  out['Authorization'] =
    `AWS4-HMAC-SHA256 Credential=${opts.credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedNames.join(';')}, Signature=${signature}`;
  return out;
}
