# @nx-devkit/terraform

Standalone Nx plugin: any directory containing `*.tf` files becomes a module project with `tf:fmt`, `tf:validate`, and `tf:plan` targets — Terraform or OpenTofu, no `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/terraform
```

Depends on `@nx/devkit` `^24`. `terraform` (or `tofu`) must be installed and on `PATH` — it is a system binary, not an npm package, so nothing is installed as a peer.

## Register

```bash
nx add @nx-devkit/terraform   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/terraform"] }
```

For OpenTofu, switch the binary via plugin options:

```jsonc
{ "plugins": [{ "plugin": "@nx-devkit/terraform", "options": { "binary": "tofu" } }] }
```

| Option         | Default       | Description                                                       |
| -------------- | ------------- | ----------------------------------------------------------------- |
| `binary`       | `"terraform"` | CLI invoked by every target — `"terraform"` or `"tofu"`.          |
| `targetPrefix` | `"tf"`        | Prefix for inferred targets (`tf:fmt`, `tf:validate`, `tf:plan`). |

## What it infers

Every directory that contains at least one `*.tf` file is a module and gets its own project (nested dirs are separate modules — matching Terraform's own one-module-per-directory semantics). Commands run at the workspace root and scope to the module via `-chdir`.

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger   | Target        | Command                                                                                      | Cacheable |
| --------- | ------------- | -------------------------------------------------------------------------------------------- | --------- |
| `**/*.tf` | `tf:fmt`      | `terraform -chdir=<dir> fmt -check`                                                          | yes       |
| same      | `tf:validate` | `terraform -chdir=<dir> init -backend=false -input=false && terraform -chdir=<dir> validate` | yes       |
| same      | `tf:plan`     | `terraform -chdir=<dir> plan -input=false`                                                   | no        |

- `tf:fmt` is read-only (`-check` fails on unformatted files; nothing is rewritten).
- `tf:validate` runs `init -backend=false` first because `validate` requires an initialized working directory — a backendless init needs no credentials.
- `tf:plan` is **never cached** and is deliberately minimal: it needs a normally initialized module (`terraform init` with your real backend) and provider credentials.
- Directories under `node_modules/` and `.terraform/` (vendored modules) are skipped, and `.terraform/**` is excluded from inputs so `init` output never poisons the cache key.

## Credentials stay in the environment

Variables and credentials (`TF_VAR_*`, `AWS_*`, `ARM_*`, `GOOGLE_APPLICATION_CREDENTIALS`, …) are never interpolated into target commands or argv. `nx:run-commands` inherits `process.env` — supply credentials via the environment, `.tfvars` files (already covered by target inputs), or your shell's secret tooling.

## Inspect

```bash
npx nx show project infra-vpc                 # see inferred targets
npx nx run infra-vpc:tf:fmt                   # check formatting (cached)
npx nx run infra-vpc:tf:validate              # init -backend=false + validate (cached)
npx nx run-many -t tf:validate                # validate every module
npx nx run infra-vpc:tf:plan                  # plan (needs env credentials)
```
