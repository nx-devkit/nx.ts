# @nx-devkit/terraform

Agent guide for working in `packages/terraform/`. Touch ONLY this directory unless the bead body says otherwise.

## File layout

```text
packages/terraform/
├── package.json
├── generators.json         # init generator manifest
├── tsdown.config.ts        # entry: plugin.ts, generators/init/generator.ts
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── plugin.ts           # createNodesV2 — **/*.tf → tf:* targets per owning dir
│   ├── plugin.spec.ts
│   └── generators/init/    # generator.ts + schema.json + generator.spec.ts
├── README.md
└── AGENTS.md
```

## Options interface

```ts
export interface NxTerraformPluginOptions {
  binary?: 'terraform' | 'tofu'; // default "terraform"
  targetPrefix?: string; // default "tf" → tf:fmt, tf:validate, tf:plan
}
```

## Invariants

- Trigger glob is `**/*.tf` — matched files group by owning directory; one
  target set per directory (a dir with any .tf file is a module). Nested
  dirs are their own modules, matching terraform's per-directory semantics.
- Commands run with `cwd: '{workspaceRoot}'` and scope to the module via
  `-chdir='<dir>'` — the path is single-quoted so spaces/metacharacters in
  directory names cannot break or inject into the command.
- `tf:fmt` is `fmt -check` — read-only, cached. `tf:validate` chains
  `init -backend=false -input=false && validate` — validate needs an
  initialized working dir; backendless init needs no credentials — cached.
- `tf:plan` is `plan -input=false`, `cache: false` — it needs env
  credentials and a normally initialized module; its `metadata.description`
  must keep stating the env-credentials requirement.
- **Credentials and variables never reach argv.** No `TF_VAR_*`, no
  `-var`/`-var-file` flags, no provider creds in commands — terraform reads
  env and `*.tfvars` itself; `nx:run-commands` inherits `process.env`.
- Inputs: `{projectRoot}/**/*.tf` + `**/*.tf.json` (recursive — local child
  modules contribute to validate/plan) plus non-recursive `*.tfvars`,
  `*.tfvars.json`, `.terraform.lock.hcl`, and `!{projectRoot}/.terraform/**`
  — init output and vendored modules must not poison the cache key.
- `node_modules`, `.terraform`, and `..`-escaping directories are skipped;
  the workspace-root module IS supported; output is deterministic (sorted).
- No npm peer dep — terraform/tofu are system binaries; the init generator
  only registers the plugin in nx.json.
- `jsonc-parser` must stay a dependency — `@nx-devkit/internal` is bundled
  into the generator chunk and imports it (same fix as prisma `a90b406`).

## Commands

```bash
bun run test        # vitest
bun run build       # tsdown → dist/*.mjs + *.d.mts
npx tsc --noEmit -p tsconfig.json  # tsdown does not typecheck
```
