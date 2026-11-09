# pre-commit hook: Bash 4+ portability (macOS default Bash 3.2)

**Source:** [PR #155 review thread](https://github.com/nx-devkit/nx.ts/pull/155#discussion_r4518492479) (cubic-dev-ai, P2), deferred per `bro act` fix-round cap.

## Issue

`.husky/pre-commit` re-execs with `bash` and uses Bash 4+ features (`mapfile -d`, associative arrays, process substitution patterns in that form). macOS ships `/bin/bash` 3.2 by default, which lacks `mapfile` and associative arrays — the hook can abort before formatting staged files, failing commits on a default macOS install.

## Options

- Rewrite the hook in POSIX `sh` with NUL-safe handling (no `mapfile`/assoc arrays), or
- Detect Bash version and require/locate Bash 4+ (e.g. Homebrew `bash`) with a clear error, or
- Use a small helper (Node/Bun script) for NUL-safe path handling.

## Acceptance

- Pre-commit formats/restages staged files (NUL-safe) on macOS default Bash 3.2 and on Linux Bash 4+.
- Preserves the current unstaged-edit safety behavior (skip files with both staged and unstaged changes).
