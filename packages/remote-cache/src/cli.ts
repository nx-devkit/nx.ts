#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { mintToken } from './auth.ts';
import { RemoteCacheClient } from './client.ts';
import { buildBackend, loadConfig, loadConfigFile } from './config.ts';
import { createRemoteCacheServer } from './server.ts';

const USAGE = `nx-remote-cache — CREEP-safe self-hosted Nx remote cache

Usage:
  nx-remote-cache serve [--config <file>]
  nx-remote-cache mint --write <ns> --read <ns[,ns...]> [--ttl <seconds>]
  nx-remote-cache put <hash> <file>
  nx-remote-cache get <hash> [file]

serve:   config from --config file, else NXRC_* env vars (see README).
mint:    prints a signed nxrc1. token; secret from NXRC_TOKEN_SECRET.
put/get: server from NX_SELF_HOSTED_REMOTE_CACHE_SERVER and token from
         NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN — the same variables Nx
         itself consumes.
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith('--')) i++;
    else out.push(args[i]!);
  }
  return out;
}

function env(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`missing env var: ${name}`);
  return v;
}

async function cmdServe(args: string[]): Promise<void> {
  const configPath = flag(args, '--config');
  const config = configPath !== undefined ? loadConfigFile(configPath) : loadConfig();
  const server = createRemoteCacheServer({
    backend: buildBackend(config),
    tokens: config.tokens,
    ...(config.tokenSecret !== undefined ? { tokenSecret: config.tokenSecret } : {}),
    maxArtifactBytes: config.maxArtifactBytes,
  });
  server.listen(config.port, config.host, () => {
    process.stdout.write(`nx-remote-cache listening on ${config.host}:${config.port}\n`);
  });
}

async function cmdMint(args: string[]): Promise<void> {
  const write = flag(args, '--write');
  const read = flag(args, '--read');
  const ttl = flag(args, '--ttl');
  if (read === undefined) throw new Error('mint requires --read <ns[,ns...]>');
  const secret = env('NXRC_TOKEN_SECRET');
  const claims: Parameters<typeof mintToken>[0] = { r: read.split(',') };
  if (write !== undefined) claims.w = write;
  if (ttl !== undefined) claims.exp = Math.floor(Date.now() / 1000) + Number(ttl);
  process.stdout.write(`${mintToken(claims, secret)}\n`);
}

async function cmdTransfer(cmd: 'put' | 'get', args: string[]): Promise<void> {
  const [artifactRef, file] = positional(args);
  if (artifactRef === undefined) throw new Error(`${cmd} requires a <hash>`);
  const client = new RemoteCacheClient(
    env('NX_SELF_HOSTED_REMOTE_CACHE_SERVER'),
    env('NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN'),
  );
  if (cmd === 'put') {
    if (file === undefined) throw new Error('put requires a <file>');
    const result = await client.store(artifactRef, readFileSync(file));
    process.stdout.write(`${result}\n`);
    return;
  }
  const body = await client.retrieve(artifactRef);
  if (body === null) {
    process.stderr.write('not found\n');
    process.exitCode = 1;
    return;
  }
  if (file !== undefined) writeFileSync(file, body);
  else process.stdout.write(body);
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'serve':
      return cmdServe(args);
    case 'mint':
      return cmdMint(args);
    case 'put':
    case 'get':
      return cmdTransfer(cmd, args);
    default:
      process.stderr.write(USAGE);
      process.exitCode = cmd === undefined || cmd === 'help' || cmd === '--help' ? 0 : 1;
  }
}

await main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
