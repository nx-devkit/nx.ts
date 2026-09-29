#!/usr/bin/env bash
# Packed-tarball e2e: simulates a real consumer installing the built
# packages — the exact path that broke in #32 (published bin could not
# resolve the plugin it delegates to).
#
# E2E_SKIP_BUILD=1 skips the local build — used in release.yml where the
# Build step (and scripts/e2e.sh) already produced dist/ output.
set -euo pipefail
shopt -s nullglob

cd "$(dirname "$0")/.."

PACK_DIR="$(mktemp -d)"
CONSUMER="$(mktemp -d)"
# Teardown must not gate the result: rm -rf can race concurrent writes
# ("Directory not empty") — retry once, then warn and let it go.
trap 'rm -rf "$PACK_DIR" "$CONSUMER" 2>/dev/null || { sleep 2; rm -rf "$PACK_DIR" "$CONSUMER" 2>/dev/null || echo "WARN: leaked temp dirs $PACK_DIR $CONSUMER" >&2; }' EXIT

if [ "${E2E_SKIP_BUILD:-0}" = "1" ]; then
  echo "==> Skipping build (E2E_SKIP_BUILD=1)"
else
  echo "==> Building packages"
  bun run build
fi

echo "==> Packing publishable packages"
# Discover publishable packages from the workspace: every non-private
# package with a name — a new package is exercised automatically.
PUBLISHABLE=()
for manifest in packages/*/package.json; do
  if node -e 'const p=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.exit(p.name&&p.private!==true?0:1)' "$manifest"; then
    PUBLISHABLE+=("$(dirname "$manifest")")
  fi
done
if [ "${#PUBLISHABLE[@]}" -eq 0 ]; then
  echo "ERROR: no publishable packages found under packages/" >&2
  exit 1
fi

for pkg_dir in "${PUBLISHABLE[@]}"; do
  echo "  packing $pkg_dir"
  # prepublishOnly (clean rebuild) runs on npm publish, NOT npm pack —
  # run it here so the e2e tarball matches what publish actually ships.
  (cd "$pkg_dir" && npm run --if-present prepublishOnly >/dev/null && npm pack --pack-destination "$PACK_DIR" >/dev/null)
done

TARBALLS=("$PACK_DIR"/*.tgz)
if [ "${#TARBALLS[@]}" -ne "${#PUBLISHABLE[@]}" ]; then
  echo "ERROR: expected ${#PUBLISHABLE[@]} tarballs, got ${#TARBALLS[@]}" >&2
  exit 1
fi
printf '  %s\n' "${TARBALLS[@]}"

echo "==> Installing every tarball into a scratch consumer"
cd "$CONSUMER"
# No Nx daemon in the scratch consumer — a persistent daemon keeps writing
# under .nx/ and races the temp-dir teardown on EXIT.
export NX_DAEMON=false
cat > package.json <<'JSON'
{"name":"e2e-packed-consumer","private":true,"type":"module"}
JSON
cat > tsconfig.json <<'JSON'
{"compilerOptions":{"strict":true}}
JSON
# Test/lint inputs exist BEFORE init so the bootstrap generator detects
# vitest + oxlint configs and installs the matching dev deps itself.
cat > vitest.config.ts <<'TS'
export default { test: { include: ['*.spec.ts'] } }
TS
cat > index.spec.ts <<'TS'
import { expect, it } from 'vitest'
import { ok } from './index'
it('ok', () => expect(ok()).toBe(true))
TS
cat > .oxlintrc.json <<'JSON'
{}
JSON
# A real consumer always has .gitignore — oxlint/eslint honour it and skip node_modules.
cat > .gitignore <<'TXT'
node_modules
dist
TXT
# The init generator's install task runs bare `npm install` — .npmrc keeps
# the peer policy consistent (legacy) so CI's npm version doesn't crash
# arborist on the optional-peer chain (vite-plus → vitest@5).
cat > .npmrc <<'TXT'
legacy-peer-deps=true
TXT
# --legacy-peer-deps: npm's default peer auto-install pulls *optional* peers
# too, and upstream optional-peer chains can conflict with each other (seen:
# oxlint → vite-plus → vitest@5 vs our vitest@^4 optional peer → ERESOLVE).
# This e2e verifies our tarballs install and the bin boots — peer resolution
# policy belongs to the consumer, not to this test.
#
# Legacy mode skips required peers too, so nx/@nx/devkit are installed
# explicitly at the declared support range — otherwise the init bin's own
# bootstrap would install registry-latest Nx and the e2e would lose its
# Nx-compatibility signal (and re-run default peer resolution anyway).
# E2E_NX_RANGE narrows the install to a single major for the CI matrix.
NX_RANGE="${E2E_NX_RANGE:-^22 || ^23}"
npm install --save-dev --legacy-peer-deps "${TARBALLS[@]}" "nx@${NX_RANGE}" "@nx/devkit@${NX_RANGE}"

echo "==> Running the packed bootstrap bin"
./node_modules/.bin/nx-devkit-typescript init

echo "==> Verifying registration"
if [ ! -f nx.json ]; then
  echo "ERROR: init did not create nx.json" >&2
  exit 1
fi
grep -q '"@nx-devkit/typescript"' nx.json

echo "==> Verifying plugin resolution + inferred project"
./node_modules/.bin/nx show projects | grep -q e2e-packed-consumer

echo "==> Checking published manifests for workspace-protocol leaks"
# Regression guard (#74): a `workspace:*` spec in a published manifest breaks
# `npm install` for consumers. Tarball package.json files must not contain one.
if grep -rl '"workspace:' node_modules/@nx-devkit/*/package.json; then
  echo "ERROR: workspace:* spec leaked into a published manifest" >&2
  exit 1
fi

echo "==> Running an inferred target against the installed tarballs"
# The init generator already installed typescript + native-preview; give
# typecheck a real input so tsc/tsgo has something to check.
cat > index.ts <<'TS'
export const ok = (): boolean => true
TS
# #74 regression class: inference that works in the monorepo but ships targets
# pointing at files absent from the tarball. A real run catches missing
# executors and unresolved plugin paths — `nx show projects` alone cannot.
./node_modules/.bin/nx run e2e-packed-consumer:typecheck

echo "==> Running inferred test + lint targets against the installed tarballs"
# vitest + oxlint were installed by the init generator (configs above) —
# these targets come from the packed preset, not local source.
./node_modules/.bin/nx run e2e-packed-consumer:test
./node_modules/.bin/nx run e2e-packed-consumer:lint

echo "==> Packed-tarball e2e passed"
