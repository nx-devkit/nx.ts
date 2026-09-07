# Design: @nx-devkit/skillspector

## Architecture

```
packages/skillspector/
├── package.json              # @nx-devkit/skillspector
├── tsdown.config.ts          # entry: src/index.ts
├── vitest.config.ts
├── executors.json
├── src/
│   ├── index.ts              # re-exports createNodesV2 + executor
│   ├── plugin.ts             # createNodesV2 — SKILL.md → scan target
│   ├── executors/
│   │   └── scan/
│   │       ├── executor.ts   # run SkillSpector, emit annotations + SARIF
│   │       └── schema.json   # executor options schema
│   └── lib/
│       ├── skillspector.ts   # CLI wrapper (spawn skillspector scan)
│       ├── mapping.ts        # JSON findings → SARIF 2.1.0
│       ├── annotations.ts    # JSON findings → GitHub ::error/::warning
│       └── sarif.ts          # SARIF 2.1.0 types
├── test/
│   ├── plugin.spec.ts
│   └── executor.spec.ts
├── README.md
└── AGENTS.md
```

## Plugin: createNodesV2

```ts
import { createHash } from 'node:crypto';

export const createNodesV2: CreateNodesV2<NxDevkitSkillspectorOptions> = [
  '**/SKILL.md',
  (configFiles, options = {}, context) => {
    const opts = { ...defaultOptions, ...options };
    return configFiles
      .map((skillFile) => {
        const skillDir = dirname(skillFile);
        const projectRoot = relative(context.workspaceRoot, resolve(context.workspaceRoot, skillDir))
          .replace(/\\/g, '/');
        // Collision-resistant project name (same algorithm as
        // @nx-devkit/skill): full path with slashes→dashes + first 8 hex
        // chars of SHA-256.
        const pathHash = createHash('sha256').update(projectRoot).digest('hex').slice(0, 8);
        const projectName = `${projectRoot.replace(/\//g, '-')}-${pathHash}`;

        if (shouldSkipPath(projectRoot, context.workspaceRoot)) return null;

        // Derive a unique per-skill SARIF path so concurrent scans don't overwrite
        // each other's reports.
        const annotationsEnabled = opts.annotations ?? true;
        const noLlm = opts.noLlm ?? true;
        const sarifPath = opts.sarif
          ? opts.sarif.replace(/\.sarif$/, '') + `-${projectName}.sarif`
          : undefined;
        // Per-project annotations file (keyed like SARIF) so concurrent Nx
        // runs don't interleave writes to a shared file. The CI step
        // concatenates all per-project files.
        const annotationsPath = `annotations-${projectName}.txt`;

        const targets: Record<string, TargetConfiguration> = {
          [opts.scanTargetName]: {
            executor: '@nx-devkit/skillspector:scan',
            // Cache only when both (a) annotations are disabled (no shared
            // side-effect file) and (b) the LLM is off (deterministic output).
            // LLM-backed scans are non-deterministic and must not be cached.
            cache: !annotationsEnabled && noLlm,
            ...(annotationsEnabled
              ? {}
              : { outputs: [
                  ...(sarifPath ? [`{workspaceRoot}/${sarifPath}`] : []),
                  `{workspaceRoot}/findings-${projectName}.json`,
                ] }),
            inputs: [
              '{projectRoot}/**/*',
              ...(opts.baseline ? [`{workspaceRoot}/${opts.baseline}`] : []),
              '^production',
            ],
            options: {
              path: projectRoot,
              noLlm: opts.noLlm ?? true,
              annotations: opts.annotations ?? true,
              failOnError: opts.failOnError ?? true,
              skillspectorBin: opts.skillspectorBin ?? 'skillspector',
              ...(sarifPath ? { sarif: sarifPath } : {}),
              ...(opts.baseline ? { baseline: opts.baseline } : {}),
            },
          },
        };

        return [skillFile, { projects: { [projectRoot]: { name: projectName, root: projectRoot, targets } } }];
      })
      .filter((r): r is [string, CreateNodesResult] => r !== null);
  },
];
```

## Scan executor

The executor runs SkillSpector on a single skill directory:

1. **Spawn** `skillspector scan <path> --format json` (add `--no-llm` only when `noLlm: true`, which is the default; omit it when `noLlm: false`)
2. **Parse** JSON output → `SkillspectorDoc` (issues array)
3. **Rewrite** issue.location.file to workspace-relative paths
4. **Filter** issues into code findings (`.ts/.js/.py/.sh/.yml/.json`) and doc findings (`.md`)
5. **Emit** GitHub Actions annotations for code findings to a **per-project** file (`annotations-<projectName>.txt`) to avoid concurrent-write corruption when Nx runs multiple skills in parallel. The CI workflow concatenates all `annotations-*.txt` files after the Nx run.
6. **Build** SARIF 2.1.0 report preserving category, confidence, remediation, code_snippet
7. **Write** per-skill findings JSON for step summary aggregation
8. **Return** `{ success: boolean }` based on fail-on-error policy

### SARIF mapping

Each SkillSpector issue maps to a SARIF result:
- `ruleId` ← `issue.id`
- `level` ← severity mapping (HIGH/CRITICAL → error, MEDIUM/WARNING → warning, else → note)
- `message.text` ← `issue.explanation`
- `locations[0].physicalLocation.artifactLocation.uri` ← workspace-relative `issue.location.file`
- `locations[0].physicalLocation.region.startLine` ← `issue.location.start_line`
- `properties` ← `{ category, confidence, remediation, code_snippet, intent, tags }`

### Annotation mapping

Code findings become `::error file=<path>,line=<n>::<rule_id>: <message>` workflow commands. Doc findings are excluded from annotations (they appear in the step summary only).

## Coexistence with @nx-devkit/skill

Both plugins trigger on `**/SKILL.md`. Nx merges targets from multiple plugins for the same project. Result:

```
project: skills-code-review-act-<hash>
targets:
  build:       @nx-devkit/skill:build
  lint:        nx:run-commands (markdownlint)
  validate:    nx:run-commands (validate-skill)
  os-check:    nx:run-commands (check-os-independence)
  size-check:  nx:run-commands (check-skill-size)
  scan:        @nx-devkit/skillspector:scan  ← this plugin
```

`nx affected -t build scan` runs both build and scan for changed skills.

## Migration path

1. Publish `@nx-devkit/skillspector` to npm (placeholder first).
2. `theplenkov-ai/skills` PR: replace `file:./actions/skillspector/nx-skillspector` with `@nx-devkit/skillspector`, remove old source.
3. `ThePlenkov/skills` PR: add `@nx-devkit/skillspector` devDependency.
4. Both repos: `nx affected -t scan` works.

### Required `nx.json` named inputs

The scan target uses `^production` (standard Nx named input for dependent project production inputs). Consumers MUST declare `namedInputs` in their `nx.json`:

```json
{
  "namedInputs": {
    "default": ["{projectRoot}/**/*"],
    "production": ["default"]
  }
}
```

If the consumer doesn't define `production`, Nx logs a warning and treats `^production` as empty (no dependent inputs), which is safe but may miss cache invalidation for cross-project dependencies.

## Risks

- **SkillSpector not installed**: the executor calls `skillspector` CLI. If not installed, it fails with a clear error. CI workflows must install it via `pip install git+https://github.com/NVIDIA/SkillSpector`. Document in README.
- **Nx stdout prefixing**: Nx prefixes worker output with ANSI-colored project names, breaking GitHub workflow commands. Mitigation: each executor writes annotations to a **per-project** file (`annotations-<projectName>.txt`) so concurrent Nx runs don't interleave writes. The CI workflow step MUST remove all `annotations-*.txt` files before invoking `nx affected -t scan` so a re-run does not re-emit stale annotations, and the concatenation step MUST tolerate no matching files (`cat annotations-*.txt 2>/dev/null || true`) for runs that select no affected projects.
- **SARIF multi-run merge**: GitHub code-scanning rejects SARIF with multiple runs sharing a category. Mitigation: per-skill SARIF files (path derived from project name, e.g. `report-skills-code-review-act-<hash>.sarif`) are merged into one run by the workflow step (not the executor).
- **Non-deterministic LLM scans**: when `noLlm: false`, SkillSpector may invoke an LLM and produce non-deterministic output. Caching is disabled in this case to prevent serving stale SARIF.

## TDD plan

1. Write failing test: plugin infers `scan` target for SKILL.md directory.
2. Write failing test: executor runs skillspector and parses JSON output (mock spawn).
3. Write failing test: executor maps issues to SARIF correctly.
4. Write failing test: executor maps code findings to annotations, doc findings excluded.
5. Write failing test: fail-on-error policy (high/critical → failure).
6. Implement, refactor, verify.
