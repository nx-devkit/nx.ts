# Security Policy

## Supported Versions

All packages under the `@nx-devkit` scope are pre-1.0. Only the latest published
minor of each package receives fixes — upgrade to the newest release before
reporting version-specific issues.

| Version | Supported |
|---|---|
| Latest published | Yes |
| Older versions | No |

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Report privately via
[GitHub Security Advisories](https://github.com/nx-devkit/nx.ts/security/advisories/new)
— the "Report a vulnerability" button on the repository's Security tab.

Include:

- the affected package(s) and version(s)
- reproduction steps or a proof of concept
- the impact you believe the issue has

You will receive an acknowledgement within a few days. If the report is
accepted, a fix is released first and the advisory is published after —
crediting you unless you prefer otherwise.

## Scope notes

These plugins infer Nx targets that invoke locally-installed tool binaries
(`vitest`, `oxlint`, `biome`, `tsdown`, …). Executors deliberately use
`execFile`/`spawn` without a shell — with one documented exception:
`@nx-devkit/diagrams` runs user-configured `commands` overrides through
`spawnSync(..., { shell: true })`. That option is an explicit opt-in escape
hatch for local renderers; its inputs still deserve scrutiny (workspace paths
are shell-quoted, but the command string is author-controlled by design).

If you find a code path where *untrusted* input (a file in the repo, a config
value a contributor could sneak in) reaches a shell, a network endpoint, or a
file write outside the workspace, that is in scope for this policy.
