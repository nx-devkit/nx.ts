# @nx-devkit/cargo

Standalone Nx plugin: every `Cargo.toml` becomes an Nx project — build,
test, clippy and fmt targets without a `project.json`. Cargo workspaces
map onto the Nx graph: member crates get `cargo -p` targets, a virtual
workspace root gets workspace-level `build`/`test`, and `path`
dependencies become `implicitDependencies` edges so `nx affected` and
`nx graph` see the crate graph.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/cargo
```

Depends on `@nx/devkit` `^24` (installed automatically). `cargo` itself is
a system toolchain — no npm peer dependency.

## Register

```bash
nx add @nx-devkit/cargo   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/cargo"] }
```

## What it infers

Each manifest with `[package]` produces a project named after
`package.name`, rooted at the manifest's directory:

| target   | command                                 | cwd             |
| -------- | --------------------------------------- | --------------- |
| `build`  | `cargo build -p <name>`                 | `{projectRoot}` |
| `test`   | `cargo test -p <name>`                  | `{projectRoot}` |
| `clippy` | `cargo clippy -p <name> -- -D warnings` | `{projectRoot}` |
| `fmt`    | `cargo fmt -p <name> -- --check`        | `{projectRoot}` |

A manifest with `[workspace]` but no `[package]` is a **virtual root** —
it gets workspace-level targets instead (`cargo build`, `cargo test`, no
`-p`) over the declared default members. A root manifest carrying both
tables is itself a crate and keeps the `-p` targets.

<!-- behavior consistent with src/plugin.ts + src/targets.ts -->

| Cargo.toml field                                       | Nx concept                                          |
| ------------------------------------------------------ | --------------------------------------------------- |
| `[package] name`                                       | project `name`; `-p <name>` in commands             |
| `[workspace]` + `[package]`                            | crate project (workspace root package)              |
| `[workspace]` without `[package]`                      | virtual-root project: `cargo build` / `cargo test`  |
| `[workspace] members` / `exclude`                      | member dirs → lockfile owner + virtual-root inputs  |
| `dep = { path = "…" }` (any dep table, `target.*` too) | `implicitDependencies` edge to that crate's project |
| `dep = { workspace = true }`                           | resolved via `[workspace.dependencies]` `path`      |

## Inputs and caching

All inferred targets are `cache: true` — cargo builds are deterministic
per inputs and the check targets produce no project artifacts. Every
crate target hashes:

- `{projectRoot}/Cargo.toml`
- `{projectRoot}/src/**/*`
- `{projectRoot}/build.rs`
- the `Cargo.lock` of the workspace that owns the crate
  (`{workspaceRoot}/<ws-root>/Cargo.lock`, or `{projectRoot}/Cargo.lock`
  for standalone crates)

The shared cargo `target/` dir is deliberately not declared as an output.

## Options

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/cargo",
      "options": { "clippy": true, "fmt": true },
    },
  ],
}
```

| option   | default | effect                              |
| -------- | ------- | ----------------------------------- |
| `clippy` | `true`  | infer the `clippy` target on crates |
| `fmt`    | `true`  | infer the `fmt` target on crates    |

## Notes

- A broken `Cargo.toml` is warned about and skipped — it never breaks
  the project graph.
- `Cargo.toml` files under `node_modules` or outside the workspace are
  ignored.
- Environment (toolchain, `RUSTFLAGS`, registry credentials) travels via
  the process environment — commands never carry secrets in argv.
