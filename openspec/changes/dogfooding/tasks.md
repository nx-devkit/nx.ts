# Tasks: dogfooding

## 1. Environment

- [x] `scripts/biome.mjs` musl/glibc shim for the Nix devcontainer; root `lint`/`format` scripts use it

## 2. Skill lifecycle

- [x] Vendor `tools/skills-compiler` (private, `skills-compiler` bin); optional `skills.config.ts`
- [x] Fix `@nx-devkit/skill:build` executor CLI contract (`--project/--target/--out-dir/--workspace-root`)
- [x] Skill check scripts: `validate-skill.ts`, `check-os-independence.ts`, `check-skill-size.ts`, `.markdownlint.json`
- [x] `skill` plugin emits `name` + `root`; 8 `skills-*` projects inferred
- [x] `nx run-many -t validate,os-check,size-check` green on all skills

## 3. SkillSpector

- [x] Install SkillSpector 2.11.2 into `.tools/skillspector-venv` (gitignored)
- [x] Fix scan executor signature `(options, context)`
- [x] `nx run-many -t scan` green on all skills

## 4. Diagrams

- [x] Reuse upstream `@nx-devkit/diagrams` (merged in PR #61); pin `outputDir: "{fileDir}/dist"` in nx.json
- [x] `docs/diagrams/{architecture,release-flow}.mmd` → SVG via Nx `diagrams` target

## 5. CI / release

- [x] `ci.yml`: Python setup, SkillSpector install, executor builds, real inferred targets, skill checks, scans
- [x] `release.yml` reviewed — placeholder step intentionally omitted (npm OIDC cannot first-publish); documented as local tool

## 6. Docs / specs

- [x] Root `README.md` matrix + repository map
- [x] `AGENTS.md` plugin matrix + dogfooding section
- [x] This OpenSpec change
