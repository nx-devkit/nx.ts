# @nx-devkit/skillspector

Zero-config Nx plugin that infers a `scan` target from `SKILL.md` files and runs SkillSpector security scans on skills.

## What it does

Scans the workspace for any file matching `**/SKILL.md`. For each match (outside the workspace root and `node_modules`), it injects a `scan` target into the project graph that runs `skillspector scan` with JSON output, writes SARIF reports, and emits GitHub workflow annotations for code findings.

## Install

```bash
bun add -D @nx-devkit/skillspector
```

## Register in nx.json

```jsonc
{
  "plugins": ["@nx-devkit/skillspector"]
}
```

## Targets generated

| Trigger file | Target | Executor | Cache | Outputs |
|---|---|---|---|---|
| `**/SKILL.md` | `scan` | `@nx-devkit/skillspector:scan` | `!annotations && noLlm` | SARIF path + `findings-${projectName}.json` (when annotations disabled) |

Each skill directory gets an injective project name: `${slug}-${hash8}` where `slug` is the relative path with `/` replaced by `-` and `hash8` is the first 8 hex chars of `sha256(projectRoot)`.

## Options

```ts
export interface NxDevkitSkillspectorOptions {
  scanTargetName?: string;    // default "scan"
  noLlm?: boolean;            // default true
  annotations?: boolean;      // default true
  failOnError?: boolean;      // default true
  skillspectorBin?: string;   // default "skillspector"
  sarif?: string;             // SARIF output path prefix
  baseline?: string;          // baseline file path
}
```

### Example: disable annotations, enable caching

```jsonc
{
  "plugins": [
    ["@nx-devkit/skillspector", { "annotations": false, "sarif": "reports/scan.sarif" }]
  ]
}
```

## Scan executor

The `scan` executor:

1. Spawns `skillspector scan <path>` with `--no-llm` (when enabled) and `--format json`
2. Parses JSON findings output
3. Writes a SARIF 2.1.0 report when `sarif` option is set
4. Emits `::error file=<path>,line=<n>::<rule_id>: <message>` annotations for code files (`.ts`, `.js`, `.py`, `.sh`, `.yml`, `.json`)
5. Doc findings (`.md`, `.txt`) are NOT annotated
6. Fails on HIGH/CRITICAL findings when `failOnError` is true

### Annotation escaping

Annotation values are security-escaped:
- `%` → `%25`
- Newlines → literal `\n` / `\r`
- `::` workflow-command delimiters are removed

## Skip rules

- The workspace root is skipped (no `scan` target on the root project).
- `node_modules` paths are skipped.
- Path traversal (`..`) segments are skipped.

## License

MIT
