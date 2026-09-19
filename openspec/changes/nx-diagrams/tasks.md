# Tasks: @nx-devkit/diagrams plugin

## 1. Scaffold package

- [ ] `packages/diagrams/package.json` (`@nx-devkit/diagrams`, peerDep `@nx/devkit ^22 || ^23`, `publishConfig.access=public`)
- [ ] `tsdown.config.ts`, `vitest.config.ts`, `tsconfig.json`
- [ ] `executors.json`, `generators.json`
- [ ] `AGENTS.md`, `README.md`
- [ ] root `nx.json`: release.projects covers `packages/*` — verify glob includes diagrams
- [ ] `bun install` succeeds

## 2. Plugin: createNodesV2

- [ ] Failing `plugin.spec.ts`: `.puml` file → `diagram-<slug>` target with cache, inputs, outputs
- [ ] Aggregate `diagrams` target on projects containing ≥1 diagram
- [ ] Nested/node_modules diagram files handled per `include`/`exclude`
- [ ] Custom `targetName`/`format`/`outputDir` options reflected in inferred targets
- [ ] Basename collisions resolved via relpath slug

## 3. Render executor

- [ ] Failing `render.spec.ts`: kroki path POSTs `{krokiUrl}/{type}/{format}` with source body, writes bytes to output
- [ ] `commands[type]` override spawns with `{input}` `{output}` `{format}` `{fileDir}` interpolation, non-zero exit fails with stderr
- [ ] Unknown type with no command → actionable error
- [ ] Kroki non-2xx → error includes response body snippet
- [ ] Batch mode renders all configured files in target context
- [ ] `dryRun` reports planned outputs without writing

## 4. init generator

- [ ] Failing `generator.spec.ts`: registers plugin, dedupes string/tuple/object forms, JSONC-preserving
- [ ] Missing `nx.json` → creates it
- [ ] Checklist prints real root project name + plugin path

## 5. Docs

- [ ] README: kroki default + self-host docker-compose snippet, commands override examples, inputs/outputs/caching explanation, binary-output git policy
- [ ] Package `AGENTS.md`

## 6. Verify + ship

- [ ] `bun test`, `bun run lint`, `bun run format:check`, `bun run build`, `bun run check:spec`, `bunx openspec validate nx-diagrams --strict`
- [ ] PR + review loop to `exit_gate=OK`

## 7. Publish (separate bead)

- [ ] `tools:prepare-for-release` placeholder → real version → `npm trust github` for `@nx-devkit/diagrams` → verify OIDC release
