# Tasks: TypeScript mega-preset

Tasks map to independent beads. Status: `[ ]` pending, `[x]` done.

## 1. Native Node test runner inference

- [x] Add `inferNativeTestTargets()` to `packages/typescript-preset/src/plugin.ts`
- [x] Add test-file discovery: when no `vitest.config.*` is found, filter `configFiles` for tsconfig paths to identify projects, then use `readdirSync` (recursive) to scan `src/` and `test/` for `*.test.{ts,js,mts,mjs}` / `*.spec.{ts,js,mts,mjs}` matches; only infer native targets when at least one test file is present (note: `configFiles` from `createNodesV2` contains both tsconfig and test file paths due to the combined matcher)
- [x] Add `test` target: `node --test --test-reporter spec "<testGlob>"`
- [x] Add `test:tap` target when `tap: true`: `node --test --test-reporter tap "<testGlob>" > test-results.tap` (outputs: `{projectRoot}/test-results.tap`)
- [x] Add `test:coverage` target when `coverage: true`: `node --test --experimental-test-coverage "<testGlob>"`
- [x] Derive target `inputs` from `testGlob` (e.g. `{projectRoot}/{testGlob}`) so the cache hashes exactly the executed files
- [ ] Document Node >= 22.18.0 requirement for native TypeScript tests (or >= 22.6.0 with `--experimental-strip-types`)
- [x] Write tests: project with test files, no vitest config → native targets inferred
- [x] Write tests: project with vitest config → vitest targets, NOT native
- [x] Write tests: project with no test files → no test targets

## 2. Mega-preset delegation — oxlint

- [x] Add `.oxlintrc.*` detection in `createNodesV2`
- [x] Add `lint` target: `npx oxlint .` (when `oxlint: true` and `.oxlintrc.*` exists)
- [x] Write tests: project with `.oxlintrc.json` → `lint` target inferred

## 3. Mega-preset delegation — biome

- [x] Add `biome.json` / `biome.jsonc` detection
- [x] Add `format` target: `npx biome format --write .` (cache: false)
- [x] Add `format-check` target: `npx biome format --check .` (cache: true)
- [x] Add `lint` target: `npx biome lint .` (cache: true) — only when no oxlint config
- [x] Write tests: project with `biome.json` → format targets inferred

## 4. Mega-preset delegation — tsdown

- [x] Add `tsdown.config.ts` detection
- [x] Add `build` target: `npx tsdown` (cache: true, outputs: `dist/`, dependsOn: `^build`)
- [x] Write tests: project with `tsdown.config.ts` → `build` target inferred

## 5. Options + documentation

- [x] Extend `NxDevkitTypescriptOptions` interface with new options
- [x] Update `packages/typescript-preset/README.md` with mega-preset usage
- [ ] Update `openspec/specs/SPEC.md` file-trigger matrix
- [x] Update `packages/typescript-preset/AGENTS.md` with new inference rules
- [x] Run `bun run check:spec` — no conflicts with standalone plugins

## 6. Verification

- [x] `bun test` — all tests pass
- [x] `bun run build` — build succeeds
- [x] `bun run lint` — clean
- [x] `bun run format:check` — clean
- [x] `bash scripts/e2e.sh` — demo workspace passes with mega-preset only (no standalone plugins)

## 7. ESLint fallback (added post-original-spec)

- [x] Add `eslint.config.*` detection in `createNodesV2`
- [x] Add `inferEslintTarget()` producing cached `lint` target (`npx eslint .`)
- [x] Lint precedence: oxlint > eslint > biome
- [x] Add `eslint?: boolean` option (default: true)
- [x] Write tests: eslint config → lint target; oxlint wins over eslint; eslint wins over biome

## 8. Tsdown watch mode (added post-original-spec)

- [x] Add `build:watch` target: `npx tsdown --watch` (cache: false)
- [x] Write tests: tsdown.config.ts → build:watch target inferred

## 9. Init generator (added post-original-spec)

- [x] Add `@nx-devkit/typescript:init` generator
- [x] Idempotently register plugin in `nx.json` `plugins[]`
- [x] Add `generators.json` manifest + schema
- [x] Write tests: registration, dedup, custom path, missing nx.json
