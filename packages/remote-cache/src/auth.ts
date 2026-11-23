import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A statically-configured bearer token. Each token is bound to:
 * - `read`: namespaces it may read, in priority order (first hit wins).
 * - `write`: the single namespace its PUTs land in. Omit for read-only.
 *
 * Namespacing is the CREEP defense: a token minted for `pr-42` CI can read
 * `main` artifacts but can only ever write into `pr-42` — it can never
 * overwrite or pre-create keys that `main` jobs will read.
 */
export interface StaticToken {
  token: string;
  /** Write namespace. Omit for a read-only token. */
  write?: string;
  /** Read namespaces in priority order. Empty array = no read access. */
  read: string[];
}

/** Claims carried inside a signed `nxrc1.` token. */
export interface TokenClaims {
  /** Write namespace (single). */
  w?: string;
  /** Read namespaces in priority order. */
  r: string[];
  /** Expiry, unix epoch seconds. */
  exp?: number;
}

/** What a request is allowed to do, resolved from its bearer token. */
export interface TokenGrants {
  /** Write namespace, undefined for read-only tokens. */
  write?: string;
  /** Read namespaces in priority order. */
  read: string[];
}

export interface AuthConfig {
  tokens: StaticToken[];
  /** HMAC secret used to verify `nxrc1.` signed tokens. */
  tokenSecret?: string;
}

const SIGNED_PREFIX = 'nxrc1.';
const NAMESPACE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const HASH_RE = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidNamespace(ns: string): boolean {
  // typeof guard — RegExp.test coerces, so `null`/`{}` would pass.
  return typeof ns === 'string' && NAMESPACE_RE.test(ns);
}

export function isValidHash(hash: string): boolean {
  return HASH_RE.test(hash);
}

function safeEqual(a: string, b: string): boolean {
  // Compare digests, not raw tokens — the length check timingSafeEqual
  // needs would leak the expected token length through response timing.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Mint a signed token: `nxrc1.<base64url claims>.<base64url hmac>`.
 * Lets a trusted controller hand out short-lived, namespace-scoped
 * credentials (e.g. one per pull request) without a config redeploy.
 */
export function mintToken(claims: TokenClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${SIGNED_PREFIX}${payload}.${sign(payload, secret)}`;
}

function resolveSigned(token: string, secret: string): TokenGrants | null {
  const body = token.slice(SIGNED_PREFIX.length);
  const dot = body.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = body.slice(0, dot);
  const signature = body.slice(dot + 1);
  if (!signature || !safeEqual(sign(payload, secret), signature)) return null;

  let claims: TokenClaims;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    claims = parsed as TokenClaims;
  } catch {
    return null;
  }

  if (claims.exp !== undefined) {
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return null;
  }
  if (claims.w !== undefined && (typeof claims.w !== 'string' || !isValidNamespace(claims.w))) {
    return null;
  }
  if (
    !Array.isArray(claims.r) ||
    claims.r.some((ns) => typeof ns !== 'string' || !isValidNamespace(ns))
  ) {
    return null;
  }

  const grants: TokenGrants = { read: claims.r };
  if (claims.w !== undefined) grants.write = claims.w;
  return grants;
}

/**
 * Resolve a bearer token to its grants. Returns null when the token is
 * unknown, malformed, tampered, or expired → the caller answers 401.
 * Signed `nxrc1.` tokens are checked first, then the static table.
 */
export function resolveGrants(token: string, config: AuthConfig): TokenGrants | null {
  if (token.startsWith(SIGNED_PREFIX)) {
    if (!config.tokenSecret) return null;
    return resolveSigned(token, config.tokenSecret);
  }
  for (const entry of config.tokens) {
    if (!isValidTokenShape(entry)) continue;
    if (safeEqual(entry.token, token)) {
      const grants: TokenGrants = { read: entry.read };
      if (entry.write !== undefined) grants.write = entry.write;
      return grants;
    }
  }
  return null;
}

function isValidTokenShape(entry: StaticToken): boolean {
  return (
    typeof entry.token === 'string' &&
    entry.token.length > 0 &&
    (entry.write === undefined || isValidNamespace(entry.write)) &&
    Array.isArray(entry.read) &&
    entry.read.every(isValidNamespace)
  );
}
