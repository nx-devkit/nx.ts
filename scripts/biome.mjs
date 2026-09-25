#!/usr/bin/env node
// Biome launcher: on Nix/devenv Linux the glibc build of
// @biomejs/cli-linux-x64 cannot exec (no /lib64/ld-linux-x86-64.so.2) even
// Though `ldd` reports glibc, so biome's own musl detection misfires.
// When the dynamic loader is missing, resolve the musl build via the
// @biomejs/biome package's own dependency graph and spawn it directly.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { arch, platform } from 'node:process'

const rootRequire = createRequire(import.meta.url),
  biomeRequire = createRequire(rootRequire.resolve('@biomejs/biome/package.json'))

function needsMuslFallback() {
  return platform === 'linux' && arch === 'x64' && !existsSync('/lib64/ld-linux-x86-64.so.2')
}

let cmd
let args = process.argv.slice(2)
if (needsMuslFallback()) {
  try {
    cmd = biomeRequire.resolve('@biomejs/cli-linux-x64-musl/biome')
  } catch {
    cmd = null
  }
}
if (!cmd) {
  cmd = rootRequire.resolve('@biomejs/biome/bin/biome')
  args = [cmd, ...args]
  cmd = process.execPath
}

const result = spawnSync(cmd, args, { stdio: 'inherit', timeout: 300_000 })
process.exit(result.status ?? 1)
