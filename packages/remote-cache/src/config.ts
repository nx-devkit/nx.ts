import { readFileSync } from 'node:fs';
import { isValidNamespace } from './auth.ts';
import type { StaticToken } from './auth.ts';
import { FileSystemBackend } from './backends/fs.ts';
import { S3Backend } from './backends/s3.ts';
import type { CacheBackend } from './backends/types.ts';

export interface FsBackendConfig {
  type: 'fs';
  dir: string;
}

export interface S3BackendConfig {
  type: 's3';
  bucket: string;
  region?: string;
  endpoint?: string;
  prefix?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

export interface RemoteCacheConfig {
  host: string;
  port: number;
  backend: FsBackendConfig | S3BackendConfig;
  tokens: StaticToken[];
  tokenSecret?: string;
  maxArtifactBytes: number;
}

type Env = Record<string, string | undefined>;

const DEFAULT_PORT = 3000;
const DEFAULT_MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

function required(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error(`missing required configuration: ${name}`);
  }
  return value;
}

function parseTokens(raw: unknown, source: string): StaticToken[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${source}: tokens must be an array`);
  }
  return raw.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`${source}: tokens[${i}] must be an object`);
    }
    const t = entry as Record<string, unknown>;
    if (typeof t['token'] !== 'string' || t['token'] === '') {
      throw new Error(`${source}: tokens[${i}].token must be a non-empty string`);
    }
    if (
      t['write'] !== undefined &&
      (typeof t['write'] !== 'string' || !isValidNamespace(t['write']))
    ) {
      throw new Error(`${source}: tokens[${i}].write is not a valid namespace`);
    }
    if (
      !Array.isArray(t['read']) ||
      t['read'].some((ns) => typeof ns !== 'string' || !isValidNamespace(ns))
    ) {
      throw new Error(`${source}: tokens[${i}].read must be an array of namespaces`);
    }
    const out: StaticToken = { token: t['token'], read: t['read'] as string[] };
    if (t['write'] !== undefined) out.write = t['write'] as string;
    return out;
  });
}

/**
 * Load configuration from environment variables:
 *
 *   NXRC_PORT / NXRC_HOST            listen address (default 3000 / 0.0.0.0)
 *   NXRC_BACKEND                     'fs' (default) | 's3'
 *   NXRC_FS_DIR                      fs storage dir (default ./nx-remote-cache)
 *   NXRC_S3_BUCKET / ENDPOINT / REGION / PREFIX
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN
 *   NXRC_TOKENS                      inline JSON array of StaticToken
 *   NXRC_TOKENS_FILE                 path to a JSON array of StaticToken
 *   NXRC_TOKEN_SECRET                HMAC secret for nxrc1. signed tokens
 *   NXRC_MAX_ARTIFACT_BYTES          default 512 MiB
 */
function backendFromEnv(env: Env): FsBackendConfig | S3BackendConfig {
  const backendType = env['NXRC_BACKEND'] ?? 'fs';
  if (backendType === 'fs') {
    return { type: 'fs', dir: env['NXRC_FS_DIR'] ?? './nx-remote-cache' };
  }
  if (backendType === 's3') {
    return {
      type: 's3',
      bucket: required('NXRC_S3_BUCKET', env['NXRC_S3_BUCKET']),
      ...(env['NXRC_S3_ENDPOINT'] !== undefined ? { endpoint: env['NXRC_S3_ENDPOINT'] } : {}),
      ...(env['NXRC_S3_REGION'] !== undefined ? { region: env['NXRC_S3_REGION'] } : {}),
      ...(env['NXRC_S3_PREFIX'] !== undefined ? { prefix: env['NXRC_S3_PREFIX'] } : {}),
      ...(env['AWS_ACCESS_KEY_ID'] !== undefined ? { accessKeyId: env['AWS_ACCESS_KEY_ID'] } : {}),
      ...(env['AWS_SECRET_ACCESS_KEY'] !== undefined
        ? { secretAccessKey: env['AWS_SECRET_ACCESS_KEY'] }
        : {}),
      ...(env['AWS_SESSION_TOKEN'] !== undefined ? { sessionToken: env['AWS_SESSION_TOKEN'] } : {}),
    };
  }
  throw new Error(`NXRC_BACKEND must be 'fs' or 's3', got ${JSON.stringify(backendType)}`);
}

function tokensFromEnv(env: Env): StaticToken[] {
  if (env['NXRC_TOKENS_FILE'] !== undefined) {
    return parseTokens(
      JSON.parse(readFileSync(env['NXRC_TOKENS_FILE'], 'utf8')),
      'NXRC_TOKENS_FILE',
    );
  }
  if (env['NXRC_TOKENS'] !== undefined) {
    return parseTokens(JSON.parse(env['NXRC_TOKENS']), 'NXRC_TOKENS');
  }
  return [];
}

export function loadConfig(env: Env = process.env): RemoteCacheConfig {
  const backend = backendFromEnv(env);
  const tokens = tokensFromEnv(env);

  const config: RemoteCacheConfig = {
    host: env['NXRC_HOST'] ?? '0.0.0.0',
    port: env['NXRC_PORT'] !== undefined ? Number(env['NXRC_PORT']) : DEFAULT_PORT,
    backend,
    tokens,
    maxArtifactBytes:
      env['NXRC_MAX_ARTIFACT_BYTES'] !== undefined
        ? Number(env['NXRC_MAX_ARTIFACT_BYTES'])
        : DEFAULT_MAX_ARTIFACT_BYTES,
  };
  if (env['NXRC_TOKEN_SECRET'] !== undefined) config.tokenSecret = env['NXRC_TOKEN_SECRET'];
  validateNumbers(config, 'env');
  return config;
}

/** Numeric fields must be positive integers — NaN/0/non-int disables limits. */
function validateNumbers(config: RemoteCacheConfig, source: string): void {
  if (!Number.isInteger(config.port) || config.port <= 0) {
    throw new Error(`${source}: port must be a positive integer, got ${config.port}`);
  }
  if (!Number.isInteger(config.maxArtifactBytes) || config.maxArtifactBytes <= 0) {
    throw new Error(
      `${source}: maxArtifactBytes must be a positive integer, got ${config.maxArtifactBytes}`,
    );
  }
}

/**
 * Load a JSON config document. Shape mirrors RemoteCacheConfig; every
 * field except `backend` and `tokens` is optional with env-parity
 * defaults.
 */
export function loadConfigFile(path: string): RemoteCacheConfig {
  const doc: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof doc !== 'object' || doc === null) {
    throw new Error(`${path}: config must be a JSON object`);
  }
  const d = doc as Record<string, unknown>;
  if (typeof d['backend'] !== 'object' || d['backend'] === null) {
    throw new Error(`${path}: missing backend`);
  }
  const backend = d['backend'] as FsBackendConfig | S3BackendConfig;
  if (backend.type === 'fs' && typeof backend.dir !== 'string') {
    throw new Error(`${path}: fs backend requires dir`);
  }
  if (backend.type === 's3' && typeof backend.bucket !== 'string') {
    throw new Error(`${path}: s3 backend requires bucket`);
  }
  const config: RemoteCacheConfig = {
    host: typeof d['host'] === 'string' ? d['host'] : '0.0.0.0',
    port: typeof d['port'] === 'number' ? d['port'] : DEFAULT_PORT,
    backend,
    tokens: parseTokens(d['tokens'] ?? [], `${path}: tokens`),
    maxArtifactBytes:
      typeof d['maxArtifactBytes'] === 'number'
        ? d['maxArtifactBytes']
        : DEFAULT_MAX_ARTIFACT_BYTES,
  };
  if (typeof d['tokenSecret'] === 'string') config.tokenSecret = d['tokenSecret'];
  validateNumbers(config, path);
  return config;
}

/** Instantiate the configured backend. Fail loud on missing credentials. */
export function buildBackend(config: RemoteCacheConfig): CacheBackend {
  if (config.backend.type === 'fs') {
    return new FileSystemBackend(config.backend.dir);
  }
  const b = config.backend;
  return new S3Backend({
    bucket: b.bucket,
    ...(b.region !== undefined ? { region: b.region } : {}),
    ...(b.endpoint !== undefined ? { endpoint: b.endpoint } : {}),
    ...(b.prefix !== undefined ? { prefix: b.prefix } : {}),
    credentials: {
      accessKeyId: required('accessKeyId / AWS_ACCESS_KEY_ID', b.accessKeyId),
      secretAccessKey: required('secretAccessKey / AWS_SECRET_ACCESS_KEY', b.secretAccessKey),
      ...(b.sessionToken !== undefined ? { sessionToken: b.sessionToken } : {}),
    },
  });
}
