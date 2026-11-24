# @nx-devkit/dotfiles

Standalone Nx plugin: dotfiles-manager marker files become `dotfiles:*` targets on the owning project — `dotfiles:diff`, `dotfiles:apply`, `dotfiles:doctor` (chezmoi) and `dotfiles:install` (dotbot). No `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/dotfiles
```

Depends on `@nx/devkit` `^24`. chezmoi and dotbot are system tools — install them separately (`brew install chezmoi`, `pip install dotbot`, distro packages); the plugin never installs or wraps them.

## Register

```bash
nx add @nx-devkit/dotfiles   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/dotfiles"] }
```

## What it infers

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger                                                         | Detection          | Target             | Command                      | Cacheable |
| --------------------------------------------------------------- | ------------------ | ------------------ | ---------------------------- | --------- |
| `.chezmoiversion` (sibling `.chezmoi*` files augment detection) | chezmoi source dir | `dotfiles:diff`    | `chezmoi diff`               | no        |
| same                                                            |                    | `dotfiles:apply`   | `chezmoi apply`              | no        |
| same                                                            |                    | `dotfiles:doctor`  | `chezmoi doctor`             | no        |
| `install.conf.yaml` / `.install.conf.yaml`                      | dotbot config      | `dotfiles:install` | `./install` or `dotbot -c …` | no        |

Every target inspects or mutates the live home directory, so nothing is cached.

- **chezmoi**: any `.chezmoi*` entry in a directory marks it as a chezmoi source dir (the glob triggers on `.chezmoiversion`; sibling `.chezmoi*` files are detected on disk). Commands run with `cwd` = the marker's directory.
- **dotbot**: when the conventional `./install` launcher script exists in the directory it is used; otherwise the plugin runs `dotbot -c <config>` with the matched config basename (`install.conf.yaml` or `.install.conf.yaml`).

### GNU stow — not yet

Stow layouts are deliberately not inferred in v1. A stow repo has no marker file — only conventions (multiple single-purpose package dirs plus a Makefile/README mentioning stow) — so detection is heuristic and planned for a future version.

## Inspect

```bash
npx nx show projects                          # find the inferred project name
npx nx show project <name>                   # see inferred targets
npx nx dotfiles:diff <name>                  # preview chezmoi changes
npx nx dotfiles:apply <name>                 # apply them
npx nx dotfiles:doctor <name>                # chezmoi health check
npx nx dotfiles:install <name>               # run dotbot install
```
