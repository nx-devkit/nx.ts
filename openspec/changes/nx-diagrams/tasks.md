# Tasks: @nx-devkit/diagrams plugin

## 1. Scaffold package

- [x] `packages/diagrams/package.json` (`@nx-devkit/diagrams`, peerDep `@nx/devkit ^22 || ^23`, `publishConfig.access=public`)
- [x] `tsdown.config.ts`, `vitest.config.ts`, `tsconfig.json`
- [x] `executors.json`, `generators.json`
- [x] `AGENTS.md`, `README.md`
- [x] root `nx.json`: plugin registered + `release.projects` covers `packages/diagrams`
- [x] `bun install` succeeds

## 2. Plugin: createNodesV2

- [x] Failing `plugin.spec.ts`: `.puml` file → `diagram-<slug>` target with cache, inputs, outputs
- [x] Aggregate `diagrams` target on projects containing ≥1 diagram (multi-file inputs/outputs/files covered)
- [x] Nested/node_modules diagram files handled per `include`/`exclude` (incl. `{a,b}` brace alternation)
- [x] Custom `targetName`/`format`/`outputDir` options reflected in inferred targets
- [x] Basename collisions resolved via relpath slug; remaining slug/output collisions disambiguated by type+hash suffixes
- [x] `targetName` colliding with a per-file target fails inference
- [x] `outputDir` workspace-relative templating (`{fileDir}`/`{fileName}`/`{projectRoot}`), escape outside workspace rejected
- [x] Unmapped extension skipped (glob match without registry entry)

## 3. Render executor

- [x] Failing `render.spec.ts`: kroki path POSTs `{krokiUrl}/{type}/{format}` with source body + `content-type: text/plain` asserted, writes bytes to output
- [x] `commands[type]` override spawns with shell-quoted `{input}` `{output}` `{format}` `{fileDir}` `{fileName}` `{projectRoot}` interpolation, non-zero exit fails with stderr
- [x] Command timeout (`ETIMEDOUT`) and signal kills reported distinctly
- [x] `timeout` validated positive; `krokiUrl` validated absolute http(s)
- [x] Unknown type with no command → actionable error
- [x] Kroki non-2xx → error includes response body snippet
- [x] Batch mode renders all configured files in target context
- [x] Inferred `output`/`outputs` options honored (collision-suffixed paths)
- [x] `dryRun` reports planned outputs without writing

## 4. init generator

- [x] Failing `generator.spec.ts`: registers plugin, dedupes string/tuple/object forms, JSONC-preserving
- [x] Missing `nx.json` → creates it
- [x] Root project name resolution covered: project.json → nx.json → package.json
- [x] `formatFiles(tree)` runs after edits
- [x] Checklist prints real root project name + plugin path

## 5. Docs

- [x] README: kroki default + self-host docker-compose snippet (incl. mermaid/bpmn/excalidraw companions), commands override examples, inputs/outputs/caching explanation, binary-output git policy
- [x] Package `AGENTS.md`

## 6. Verify + ship

- [x] `bun test`, `bun run lint`, `bun run format:check`, `bun run build`, `bun run check:spec`, `bunx openspec validate nx-diagrams --strict`
- [x] PR #61 opened; review loop to `exit_gate=OK`

## 7. Publish (separate bead)

- [ ] `@nx-devkit/prepare-for-release:publish-placeholder` → real version → `npm trust github` for `@nx-devkit/diagrams` → verify OIDC release
