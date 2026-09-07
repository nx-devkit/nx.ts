# Design: TypeScript mega-preset

## Architecture

The mega-preset extends `packages/typescript-preset/src/plugin.ts` with three new inference paths, all triggered by file presence:

```
tsconfig.json found
  ├── typecheck target (existing — tsgo or tsc)
  ├── vitest.config.* found?
  │   └── YES → vitest targets (existing)
  │   └── NO  → test files (*.test.ts / *.spec.ts) found?
  │       └── YES → native node --test targets (NEW)
  │       └── NO  → no test targets
  ├── .oxlintrc.* found? (NEW)
  │   └── YES → lint target (npx oxlint .)
  ├── biome.json found? (NEW)
  │   └── YES → format, format-check, lint targets (npx biome ...)
  └── tsdown.config.ts found? (NEW)
      └── YES → build target (npx tsdown)
```

## Native Node test runner inference

### Discovery

Scan `src/` and `test/` directories for files matching `testGlob` (default: `{src,test}/**/*.{test,spec}.{ts,js,mts,mjs}`). Use `readdirSync` with recursive option. Skip `node_modules/`, `dist/`, `coverage/`. The `createNodesV2` matcher matches both `tsconfig*.json` and `*.{test,spec}.*` files (see "Graph invalidation" section), so `configFiles` contains a mix of tsconfig and test file paths. The callback filters `configFiles` for tsconfig paths to identify projects, then uses `readdirSync` within each project's `src/` and `test/` directories for test-file discovery.

### Graph invalidation for test-file changes

The `createNodesV2` matcher is `**/tsconfig*.json`, so the Nx daemon only re-invokes the callback when tsconfig files change — NOT when test files are added or removed. To ensure the graph stays current, the plugin MUST use a single matcher that matches BOTH tsconfig and test files, so the primary callback (which does readdirSync discovery) is re-run when either changes:

```ts
export const createNodesV2 = [
  '**/{tsconfig*.json,*.{test,spec}.{ts,js,mts,mjs}}',
  createNodes,
];
```

This ensures the callback that emits `test`/`test:tap`/`test:coverage` targets is re-invoked when test files are added or removed, not just when tsconfig changes. The TDD tests MUST assert the `test` target itself updates (not merely that the daemon wakes up).

**Custom `testGlob` limitation:** The matcher covers `*.{test,spec}.{ts,js,mts,mjs}` files. If a consumer sets a custom `testGlob` that matches files with different extensions or naming conventions (e.g. `src/**/*.unit.ts`), those files will NOT trigger graph recomputation when added or removed. The plugin MUST validate that `testGlob` matches files covered by the matcher pattern, or document that custom globs outside the matcher scope require a manual `nx reset` to update the graph.

### Targets

```ts
export function inferNativeTestTargets(projectRoot: string, options: {
  testGlob: string;
  tap: boolean;
  coverage: boolean;
}): Record<string, TargetConfiguration> {
  // Inputs are derived from testGlob so the cache hashes exactly the files
  // that node --test will execute, plus all project source files (tests import
  // source files, so changes to src/foo.ts must invalidate the cache) and
  // upstream dependency inputs (^production).
  const testInputs = [
    `{projectRoot}/${options.testGlob}`,
    '{projectRoot}/src/**/*',
    '{projectRoot}/test/**/*',
    '{projectRoot}/package.json',
    '{projectRoot}/tsconfig.json',
    '^production',
  ];
  const targets: Record<string, TargetConfiguration> = {
    test: {
      executor: 'nx:run-commands',
      cache: true,
      inputs: testInputs,
      options: {
        command: `node --test --test-reporter spec "${options.testGlob}"`,
        cwd: projectRoot,
      },
    },
  };

  if (options.tap) {
    targets['test:tap'] = {
      executor: 'nx:run-commands',
      cache: true,
      inputs: testInputs,
      options: {
        command: `node --test --test-reporter tap "${options.testGlob}" > test-results.tap`,
        cwd: projectRoot,
      },
      outputs: ['{projectRoot}/test-results.tap'],
    };
  }

  if (options.coverage) {
    targets['test:coverage'] = {
      executor: 'nx:run-commands',
      cache: true,
      inputs: testInputs,
      options: {
        command: `node --test --experimental-test-coverage "${options.testGlob}"`,
        cwd: projectRoot,
      },
    };
  }

  return targets;
}
```

### Native Node TypeScript limitation

`node --test` executes TypeScript via Node's native type-stripping loader. Type stripping was introduced in **Node 22.6.0** (`--experimental-strip-types`) and became enabled by default (no flag) in **Node 22.18.0**. Node 18.x and 20.x do NOT support running `.ts` files directly. The plugin MUST require Node >= 22.18.0 for native TypeScript tests (or >= 22.6.0 with `--experimental-strip-types`), and MUST document this version requirement in the README. The type stripper only supports **erasable syntax** (types, interfaces, type-only imports). Non-erasable constructs — `enum`, `namespace`, parameter properties, and `tsconfig` path mappings — require `--experimental-transform-types` (Node 22.7+) or compilation to JavaScript first. Consumers using those features should compile tests first (`tsc` then `node --test dist/**/*.test.js`) or keep using vitest.

### Priority: vitest > native

If `vitest.config.*` exists, vitest targets are inferred and native targets are NOT. This is the existing behavior — no change needed, just a new else-branch.

## Mega-preset delegation

### Approach: inline equivalents, not plugin dependencies

The mega-preset does NOT import `@nx-devkit/tsdown`, `@nx-devkit/oxlint`, or `@nx-devkit/biome`. Instead it inlines the same `nx:run-commands` target definitions that those plugins produce. This keeps the preset dependency-free and avoids version coupling.

Consumers who want the standalone plugins can still install them — the mega-preset checks `options.tsdown !== false` etc. and only infers when the config file is present. If a standalone plugin is also registered, Nx's target-merge logic handles deduplication (last-registered wins, which is deterministic based on `nx.json` plugin order).

### Inlined targets

```ts
// tsdown
{ executor: 'nx:run-commands', cache: true, outputs: ['{projectRoot}/dist'],
  options: { command: 'npx tsdown', cwd: projectRoot },
  dependsOn: ['^build'],
  inputs: ['{projectRoot}/tsdown.config.ts', '{projectRoot}/src/**/*', '{projectRoot}/tsconfig.json', '{projectRoot}/package.json'] }

// oxlint — inputs match the full lint scope (`.`), not just src
{ executor: 'nx:run-commands', cache: true,
  options: { command: 'npx oxlint .', cwd: projectRoot },
  inputs: ['{projectRoot}/**/*', '{projectRoot}/.oxlintrc.*', '{projectRoot}/package.json'] }

// biome format
{ executor: 'nx:run-commands', cache: false,
  options: { command: 'npx biome format --write .', cwd: projectRoot } }

// biome format-check
{ executor: 'nx:run-commands', cache: true,
  options: { command: 'npx biome format --check .', cwd: projectRoot } }

// biome lint
{ executor: 'nx:run-commands', cache: true,
  options: { command: 'npx biome lint .', cwd: projectRoot } }
```

## Risks

- **Target conflicts**: if both mega-preset and standalone plugins are registered, duplicate targets may appear. Mitigation: document that consumers should pick one approach (mega-preset OR standalone plugins, not both).
- **Native test runner maturity**: `node --test` is stable in Node 22+ but coverage is still experimental. Mitigation: `coverage: true` is opt-in.
- **File discovery cost**: scanning for `*.test.ts` on every graph build could be slow in large repos. Mitigation: `readdirSync` is scoped to `src/` and `test/` only (not the whole project), and the Nx daemon caches the graph between runs. The `createNodesV2` matcher includes both `tsconfig*.json` and `*.{test,spec}.*` so the primary callback re-runs when test files are added or removed (see "Graph invalidation" section above). `configFiles` from `createNodesV2` contains both tsconfig and test file paths, so the callback filters for tsconfig to identify projects and uses `readdirSync` for test discovery within each project.

## TDD plan

1. Write failing test: project with `tsconfig.json` + `src/foo.test.ts` (no vitest config) → expect `test` target with `node --test`.
2. Write failing test: project with `vitest.config.ts` + `src/foo.test.ts` → expect vitest targets, NOT native.
3. Write failing test: project with `tsconfig.json` + `.oxlintrc.json` → expect `lint` target.
4. Write failing test: project with `tsconfig.json` + `biome.json` → expect `format`, `format-check`, `lint` targets.
5. Write failing test: project with `tsconfig.json` + `tsdown.config.ts` → expect `build` target.
6. Write failing test: incremental graph — adding `src/new.test.ts` triggers graph recomputation AND the `test` target is updated (not merely daemon wakeup).
7. Write failing test: incremental graph — removing `src/foo.test.ts` triggers graph recomputation AND the `test` target is removed.
8. Implement, refactor, verify.
