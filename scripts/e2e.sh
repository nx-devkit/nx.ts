#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Building packages"
bun run build

cd apps/demo

echo "==> Installing dependencies in apps/demo"
bun install

# Nix/devenv workaround: the glibc build of @biomejs/cli-linux-x64 cannot
# exec here (no /lib64/ld-linux-x86-64.so.2). Biome's own bin wrapper honors
# BIOME_BINARY — point it at the musl build resolved via the package's own
# dependency graph.
if [ ! -e /lib64/ld-linux-x86-64.so.2 ]; then
  BIOME_BINARY="$(cd .. && node -e "console.log(require('node:module').createRequire(require.resolve('@biomejs/biome/package.json')).resolve('@biomejs/cli-linux-x64-musl/biome'))")"
  export BIOME_BINARY
fi

echo "==> Running nx run-many against demo workspace"
node_modules/.bin/nx run-many -t build typecheck lint format-check test
