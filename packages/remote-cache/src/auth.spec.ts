import { describe, expect, it } from 'vitest';
import { mintToken, resolveGrants, isValidNamespace, isValidHash } from './auth.ts';
import type { StaticToken } from './auth.ts';

const STATIC: StaticToken[] = [
  { token: 'main-secret', write: 'main', read: ['main'] },
  { token: 'ro-secret', read: ['main'] },
  { token: 'pr-secret', write: 'pr-9', read: ['main', 'pr-9'] },
];

describe('resolveGrants — static tokens', () => {
  it('resolves a write token', () => {
    const g = resolveGrants('main-secret', { tokens: STATIC });
    expect(g).toMatchObject({ write: 'main', read: ['main'] });
  });

  it('resolves a read-only token', () => {
    const g = resolveGrants('ro-secret', { tokens: STATIC });
    expect(g).not.toBeNull();
    expect(g?.write).toBeUndefined();
    expect(g?.read).toEqual(['main']);
  });

  it('returns null for an unknown token', () => {
    expect(resolveGrants('nope', { tokens: STATIC })).toBeNull();
  });

  it('returns null for an empty token list', () => {
    expect(resolveGrants('main-secret', { tokens: [] })).toBeNull();
  });
});

describe('signed tokens (nxrc1.)', () => {
  const secret = 'test-signing-secret';

  it('round-trips claims', () => {
    const token = mintToken({ w: 'pr-42', r: ['main', 'pr-42'] }, secret);
    expect(token.startsWith('nxrc1.')).toBe(true);
    const g = resolveGrants(token, { tokens: [], tokenSecret: secret });
    expect(g).toMatchObject({ write: 'pr-42', read: ['main', 'pr-42'] });
  });

  it('mints read-only tokens when w is omitted', () => {
    const token = mintToken({ r: ['main'] }, secret);
    const g = resolveGrants(token, { tokens: [], tokenSecret: secret });
    expect(g?.write).toBeUndefined();
    expect(g?.read).toEqual(['main']);
  });

  it('rejects a token signed with the wrong secret', () => {
    const token = mintToken({ w: 'main', r: ['main'] }, 'other-secret');
    expect(resolveGrants(token, { tokens: [], tokenSecret: secret })).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = mintToken({ w: 'pr-1', r: ['pr-1'] }, secret);
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
    payload.w = 'main';
    parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
    expect(resolveGrants(parts.join('.'), { tokens: [], tokenSecret: secret })).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = mintToken({ w: 'pr-1', r: ['pr-1'], exp: 1_000_000 }, secret);
    expect(resolveGrants(token, { tokens: [], tokenSecret: secret })).toBeNull();
  });

  it('accepts a token whose expiry is in the future', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = mintToken({ r: ['main'], exp }, secret);
    expect(resolveGrants(token, { tokens: [], tokenSecret: secret })).not.toBeNull();
  });

  it('rejects nxrc1. tokens when no tokenSecret is configured', () => {
    const token = mintToken({ w: 'main', r: ['main'] }, secret);
    expect(resolveGrants(token, { tokens: STATIC })).toBeNull();
  });

  it('rejects malformed tokens', () => {
    for (const t of ['nxrc1.', 'nxrc1.x', 'nxrc1.x.y.z', 'nxrc1.@@#.sig']) {
      expect(resolveGrants(t, { tokens: [], tokenSecret: secret })).toBeNull();
    }
  });
});

describe('validation helpers', () => {
  it('accepts sane namespaces', () => {
    for (const ns of ['main', 'pr-42', 'release_2026.1']) {
      expect(isValidNamespace(ns)).toBe(true);
    }
  });

  it('rejects dangerous namespaces', () => {
    for (const ns of ['', '..', 'a/b', 'a b', '.hidden', 'a'.repeat(200)]) {
      expect(isValidNamespace(ns)).toBe(false);
    }
  });

  it('accepts sane hashes', () => {
    expect(isValidHash('0123456789abcdef')).toBe(true);
    expect(isValidHash('a-b_c')).toBe(true);
  });

  it('rejects dangerous hashes', () => {
    for (const h of ['', '..', 'a/b', 'a b', 'a'.repeat(200)]) {
      expect(isValidHash(h)).toBe(false);
    }
  });
});
