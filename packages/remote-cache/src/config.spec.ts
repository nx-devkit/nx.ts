import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, loadConfigFile } from './config.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nxrc-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadConfig (env)', () => {
  it('defaults to the fs backend with sane defaults', () => {
    const cfg = loadConfig({
      NXRC_TOKENS: JSON.stringify([{ token: 't', write: 'main', read: ['main'] }]),
    });
    expect(cfg.port).toBe(3000);
    expect(cfg.backend).toMatchObject({ type: 'fs' });
    expect(cfg.tokens).toHaveLength(1);
    expect(cfg.maxArtifactBytes).toBeGreaterThan(0);
  });

  it('parses s3 env config', () => {
    const cfg = loadConfig({
      NXRC_BACKEND: 's3',
      NXRC_S3_BUCKET: 'bkt',
      NXRC_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
      NXRC_S3_REGION: 'auto',
      NXRC_S3_PREFIX: 'nx',
      NXRC_TOKENS_FILE: undefined,
      AWS_ACCESS_KEY_ID: 'k',
      AWS_SECRET_ACCESS_KEY: 's',
      NXRC_TOKENS: '[]',
    });
    expect(cfg.backend).toMatchObject({
      type: 's3',
      bucket: 'bkt',
      endpoint: 'https://acct.r2.cloudflarestorage.com',
      prefix: 'nx',
    });
  });

  it('reads tokens from a file', () => {
    const file = join(dir, 'tokens.json');
    writeFileSync(file, JSON.stringify([{ token: 'ft', write: 'main', read: ['main'] }]));
    const cfg = loadConfig({ NXRC_TOKENS_FILE: file });
    expect(cfg.tokens[0]!.token).toBe('ft');
  });

  it('fails loud on invalid token config', () => {
    expect(() => loadConfig({ NXRC_TOKENS: 'not-json' })).toThrow();
    expect(() => loadConfig({ NXRC_TOKENS: JSON.stringify([{ read: [] }]) })).toThrow();
  });
});

describe('loadConfigFile', () => {
  it('loads a full config document', () => {
    const file = join(dir, 'config.json');
    writeFileSync(
      file,
      JSON.stringify({
        port: 4000,
        backend: { type: 'fs', dir: '/tmp/cache' },
        tokens: [{ token: 't', write: 'main', read: ['main'] }],
        tokenSecret: 'sec',
        maxArtifactBytes: 1024,
      }),
    );
    const cfg = loadConfigFile(file);
    expect(cfg.port).toBe(4000);
    expect(cfg.tokenSecret).toBe('sec');
    expect(cfg.maxArtifactBytes).toBe(1024);
  });

  it('rejects missing files and bad documents', () => {
    expect(() => loadConfigFile(join(dir, 'nope.json'))).toThrow();
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{"tokens": "nope"}');
    expect(() => loadConfigFile(bad)).toThrow();
  });
});
