# Proposal: dogfooding — the repo builds itself with its own plugins

## Why

The workspace shipped plugins it did not consume: `skills/` had no inferred
lifecycle targets, `docs/` diagrams had no render pipeline, SkillSpector was
not wired into Nx, and CI only exercised package-level lint/build/test. A
plugin repo that does not run on its own plugins cannot claim they work.

## What Changes

### Diagrams: `docs/diagrams/*.mmd`

Rendered by the upstream `@nx-devkit/diagrams` plugin (already on `main`) via
the inferred `diagrams` target — Kroki backend, `outputDir` pinned to
`{fileDir}/dist` so generated SVGs stay gitignored.

### NEW internal tooling: `tools/skills-compiler/`

- Private vendored copy of `ThePlenkov/skills` `tools/compiler` (Apache-2.0
  source; not on npm). Provides the `skills-compiler` bin used by
  `@nx-devkit/skill:build`. `skills.config.ts` import is optional.

### Root workspace wiring (`nx.json`, `package.json`)

- Registered plugins: typescript preset, `skill`, `skillspector`
  (`skillspectorBin: .tools/skillspector-venv/bin/skillspector`), `diagrams`
  (`renderer: local`), `nx-cloud`, `prepare-for-release`.
- New devDeps: `tsx`, `markdownlint-cli2`, `beautiful-mermaid`,
  `@nx-devkit/skills-compiler` (workspace).
- New check scripts: `validate-skill.ts`, `check-os-independence.ts`,
  `check-skill-size.ts`, `.markdownlint.json`, `scripts/biome.mjs` (musl
  fallback for the Nix devcontainer).

### Fixes required by real execution

- `skill` + `skillspector` plugins emitted projects without `name`/`root` —
  Nx rejected the graph. Fixed.
- `skillspector` scan executor used a custom `(ctx)` signature; Nx calls
  executors as `(options, context)`. Fixed.
- `skill` build executor invoked a CLI contract the real compiler does not
  implement (`--skill/--out`); switched to `--project/--target/--out-dir/
  --workspace-root`.
- `prepare-for-release` executor read `os.homedir()`, which Bun caches at
  process start — test isolation by `process.env.HOME` did not work. Now
  prefers `process.env.HOME`.

### CI / release

- `ci.yml`: installs Python + SkillSpector (pinned tag), builds all
  executor-providing plugins first, then runs `nx run-many -t
  lint,build,test,typecheck` (covers skill lint/build + diagram render), plus
  `validate,os-check,size-check` and `scan` on `skills-*` projects.
- `release.yml` keeps `nx release` as the publish path. The
  `prepare-for-release` plugin stays the documented local bootstrap for new
  packages — npm OIDC trusted publishing cannot perform a first publish, so
  it is intentionally NOT a workflow step.
