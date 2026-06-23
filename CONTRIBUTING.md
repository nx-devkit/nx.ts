# Contributing to nx-devkit

## TDD is non-negotiable

Every plugin source change follows:

1. Write a failing `*.spec.ts` (vitest) using `@nx/devkit` testing helpers + `memfs` / tmp dirs / `vi.mock` for child_process.
2. `bun test` → RED.
3. Implement the minimum to pass.
4. `bun run build` → GREEN.
5. `bun run lint` → must be clean.
6. `bun run check:spec` → no conflicts.
7. `bunx openspec validate` → no errors.
8. Commit. Push. Open draft PR.

## OpenSpec workflow

This repo uses [OpenSpec](https://github.com/Fission-AI/OpenSpec) for spec-driven changes.

1. `openspec/changes/<change-id>/proposal.md` — what & why.
2. `openspec/changes/<change-id>/tasks.md` — checklist.
3. `openspec/changes/<change-id>/specs/<capability>/spec.md` — delta vs `openspec/specs/`.
4. `openspec validate <change-id> --strict` — must pass.
5. Once the change ships, run `openspec archive <change-id>` to fold the spec delta into `openspec/specs/`.

## Per-package scope

Each plugin lives in its own directory under `packages/`. **Touch ONLY your assigned files** unless the bead body explicitly covers more. Each `packages/<name>/AGENTS.md` restates:

- File layout
- Standard options interface
- Scope rules
- TDD workflow
- Verification commands

## Spec-conflict detector

`bun run check:spec` runs `scripts/spec-check.ts`. It scans `packages/*/src/plugin.ts` and `src/executors/*/schema.json` for:

- Two plugins registering the same target name on the same file trigger.
- Two packages exporting the same module name.
- Inconsistent option schemas across siblings.

Exits non-zero on conflict. CI runs this on every push.

## PR flow

1. Branch off `main` (do **not** branch off convoy branches).
2. One bead = one PR. Do not mix unrelated changes.
3. Push to your fork (`ThePlenkov/nx.ts`).
4. Open a **DRAFT** PR with `--draft`. The Refinery reviews.
5. Do not open upstream PRs. The user opens those manually after review.
6. Do not merge into `main` yourself.

## Adding a new plugin

```bash
bunx nx g @nx-devkit/prepare-for-release:init
```

This is the one-shot path:

- Adds the plugin to `nx.json`.
- Creates a `tools` project with a `prepare-for-release` target.
- Prints the post-setup checklist (install → bootstrap → `npm trust github`).

After running it, follow the printed checklist — install the plugin, publish placeholders, run the trust commands locally with MFA, then commit a workflow file and let CI take over forever.

## Privilege escalation

If you hit any of:

- HTTP 401/403 from npm or GitHub
- 404 from the npm registry for a package you expected to exist
- "scope" / "permission" errors
- `gh` authentication failures
- OIDC trust failures during CI

**STOP. Do not retry. Mail the mayor via `gt_mail_send` and create an `gt_escalate` bead with full context.** This applies even if the failure looks transient.

## Verification before opening a PR

```bash
bun install
bun run lint
bun test
bun run build
bash scripts/e2e.sh
bunx nx release --skip-publish --dry-run
```

All six must exit 0.