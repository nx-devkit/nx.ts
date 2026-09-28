# @nx-devkit/skill

Nx plugin for [agent skills](https://agentskills.io/specification): any directory containing `SKILL.md` becomes a project with a full skill lifecycle — `build`, `lint`, `validate`, `os-check`, `size-check`. No `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/skill
```

Depends on `@nx/devkit` `^22 || ^23` — installed automatically. The inferred targets also need their tools available: `build` invokes `skills-compiler` (resolved from `node_modules/.bin`, falling back to `PATH`) and `lint` runs `markdownlint-cli2` — add whichever you use. `validate`/`os-check`/`size-check` ship as executors inside this package — nothing extra to install:

```bash
bun add -D markdownlint-cli2   # plus the skills-compiler tool for `build`
```

## Register

```bash
nx add @nx-devkit/skill   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/skill"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts infer* functions and executors.json -->

| Target | Runs | Purpose |
|---|---|---|
| `build` | `@nx-devkit/skill:build` executor — skills-compiler via `execFile`, no shell | Compiles the skill to a distribution target. |
| `lint` | `markdownlint-cli2 '{projectRoot}/**/*.md' --config .markdownlint.json` (`--config` only when the file exists at workspace root) | Lints all skill Markdown. |
| `validate` | `@nx-devkit/skill:validate` executor | Validates `SKILL.md` frontmatter and structure. |
| `os-check` | `@nx-devkit/skill:os-check` executor | Flags OS-specific commands/paths that break cross-platform portability. |
| `size-check` | `@nx-devkit/skill:size-check` executor | Enforces size budgets on the skill directory. |

The `build` target's `inputs` are an explicit list — `SKILL.md`, `**/*.md`, `scripts/`, `references/`, `assets/`, `agents/` under the project root, plus `^production` — extended by any `skillInputs` you add. The `lint` target runs with `cwd` = workspace root; `{projectRoot}` in the command is the Nx macro, expanded by Nx before the shell runs it — the quotes keep the path literal. The executor targets receive the skill directory via the `path` option.

## Inspect

```bash
npx nx show projects
npx nx show project <name>
npx nx run <name>:build
```

## Project naming

Project names are derived from the skill directory slug plus a 12-hex-char SHA-256 suffix of the project root — collision-resistant in practice (birthday bound applies, it's not a guarantee), so two `SKILL.md` files whose directory names collapse to the same slug still get distinct project names.

## Options

<!-- option reference consistent with src/plugin.ts NxDevkitSkillOptions -->

```jsonc
{
  "plugins": [
    ["@nx-devkit/skill", {
      "buildTargetName": "build",
      "lintTargetName": "lint",
      "validateTargetName": "validate",
      "osCheckTargetName": "os-check",
      "sizeCheckTargetName": "size-check",
      "skillInputs": []
    }]
  ]
}
```

| Option | Default | Effect |
|---|---|---|
| `buildTargetName` | `build` | Name of the build target. |
| `lintTargetName` | `lint` | Name of the lint target. |
| `validateTargetName` | `validate` | Name of the validate target. |
| `osCheckTargetName` | `os-check` | Name of the OS-independence check target. |
| `sizeCheckTargetName` | `size-check` | Name of the size-check target. |
| `skillInputs` | `[]` | Extra input globs merged into the `build` target's inputs. |

All five target names must be non-empty and unique — on an empty or duplicate name the plugin logs a warning and skips that skill's project (other skills are unaffected).

## Skip rules

- `SKILL.md` inside `node_modules` is skipped.
- `SKILL.md` at the workspace root is skipped — skills live in nested directories.
- `SKILL.md` escaping the workspace root is skipped.

## Pairing with skillspector

For security scanning of skills, add [`@nx-devkit/skillspector`](../skillspector/README.md) alongside — it infers a `scan` target from the same `SKILL.md` trigger.

## License

MIT
