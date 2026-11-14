# Release pipeline — reusable GitHub workflows

This directory contains nx.ts's release pipeline, published as **reusable
workflows** (`workflow_call`). Any Nx + bun monorepo with conventional
commits and npm OIDC trusted publishing can adopt the whole flow — the
maintained `next` draft release, AI-generated highlights, and publish-on-
draft — by calling three workflows from its own caller file.

## Architecture

| Workflow           | Trigger (native)              | Reusable file               | Role                                                                                                                                                                                                                                                 |
| ------------------ | ----------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release-preview`  | push/dispatch/workflow_run    | `release-preview.yml`       | Recomputes the pending release on every push to the release branch and upserts the **draft** GitHub release tagged `next` (prerelease flag set). Uploads the body as the `release-preview-body` artifact. Deletes the draft when nothing is pending. |
| `release-ai-notes` | workflow_run/dispatch         | `release-ai-notes.lock.yml` | gh-aw agent that prepends a `## Highlights` section to the `next` draft. Safe-outputs + threat detection; only ever writes the `next` draft.                                                                                                         |
| `release`          | `release: published`/dispatch | `release.yml`               | Runs `nx release version` + `nx release publish` (npm OIDC), opens the release PR, pushes tags, cleans up the published `next`.                                                                                                                      |

Publishing the `next` draft **is** the release decision — nothing publishes
automatically. The draft body says so explicitly.

## Consumer setup

Create one caller workflow in the consuming repo (e.g.
`.github/workflows/release.yml`):

```yaml
name: release
on:
  push:
    branches: [main]
  release:
    types: [published]
  workflow_dispatch:

jobs:
  preview:
    # Maintain the "next" draft on every push to the release branch.
    if: github.event_name != 'release'
    permissions:
      contents: write # draft release create/edit/delete
    uses: nx-devkit/nx.ts/.github/workflows/release-preview.yml@<ref>
    with:
      source-ref: <ref> # same ref as the uses: pin
    secrets:
      NX_CLOUD_ACCESS_TOKEN: ${{ secrets.NX_CLOUD_ACCESS_TOKEN }}

  ai-notes:
    # AI Highlights — omit this job entirely, or set `disabled: true`,
    # to run the pipeline without AI notes.
    needs: preview
    if: github.event_name != 'release' && needs.preview.result == 'success'
    permissions:
      # Mirror what the compiled workflow requests — a caller's token can
      # only be intersected DOWN, never elevated, so grant the full set:
      contents: write # the safe-output writer edits the next draft
      actions: read # artifact lookup + gh run download
      issues: write # gh-aw status/activation comments
      pull-requests: read # gh-aw reads PR context; the compiled jobs never write PRs
      checks: read # gh-aw conclusion reporting
    uses: nx-devkit/nx.ts/.github/workflows/release-ai-notes.lock.yml@<ref>
    secrets:
      ANYROUTER_API_KEY: ${{ secrets.ANYROUTER_API_KEY }}

  publish:
    # Fires when a human publishes the "next" draft.
    if: github.event_name == 'release' && github.event.release.tag_name == 'next'
    permissions:
      contents: write
      pull-requests: write
      id-token: write # npm OIDC trusted publishing
    uses: nx-devkit/nx.ts/.github/workflows/release.yml@<ref>
    with:
      source-ref: <ref>
    secrets:
      NX_CLOUD_ACCESS_TOKEN: ${{ secrets.NX_CLOUD_ACCESS_TOKEN }}
```

`<ref>` is whatever you pin the `uses:` calls to — a tag, branch, or commit
SHA. Pin a SHA for stability; pass the **same** value as `source-ref` so
helper scripts (`scripts/release-preview.ts`,
`scripts/rewrite-workspace-protocol.ts`) load from the same revision.

## Inputs

### `release-preview.yml`

| Input        | Type                               | Default      | Purpose                                                                                                                                                   |
| ------------ | ---------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `specifier`  | string `none\|patch\|minor\|major` | `none`       | Force a version bump, bypassing conventional commits (preview demos). `workflow_call` has no `choice` type — anything outside the list behaves as `none`. |
| `branch`     | string                             | `main`       | Release branch the draft tracks.                                                                                                                          |
| `source-ref` | string                             | **required** | nx-devkit/nx.ts ref for helper scripts.                                                                                                                   |

Secrets: `NX_CLOUD_ACCESS_TOKEN` (optional — only silences Nx Cloud 401s).

### `release.yml`

| Input                    | Type    | Default                   | Purpose                                                                                               |
| ------------------------ | ------- | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `specifier`              | string  | `none`                    | Same as preview.                                                                                      |
| `branch`                 | string  | `main`                    | Branch releases are cut from.                                                                         |
| `source-ref`             | string  | **required**              | nx-devkit/nx.ts ref for helper scripts.                                                               |
| `tag-prefix`             | string  | `@nx-devkit/`             | Tag prefix identifying releasable packages (`<prefix><project>@<version>`).                           |
| `release-branch`         | string  | `chore/release-publish`   | Branch the version+changelog commit is pushed to for the release PR.                                  |
| `changelog-glob`         | string  | `packages/*/CHANGELOG.md` | Pathspec glob for generated changelogs committed onto the release branch.                             |
| `verify-command`         | string  | `''`                      | Replace the built-in verify chain (lint/check:spec/build/test/e2e). Pass `true` to skip verification. |
| `skip-workspace-rewrite` | boolean | `false`                   | Skip the `workspace:`-protocol manifest rewrite (only needed with private workspace deps).            |

The caller job **must** grant `contents: write`, `pull-requests: write`,
`id-token: write` — npm OIDC trusted publishing exchanges the OIDC token,
no `NPM_TOKEN` is used.

### `release-ai-notes.lock.yml`

| Input      | Type    | Default | Purpose                      |
| ---------- | ------- | ------- | ---------------------------- |
| `disabled` | boolean | `false` | Skip the agent run entirely. |
| `branch`   | string  | `main`  | Release branch guard.        |

Secrets: `ANYROUTER_API_KEY` (optional — without it the engine cannot
reach the model; omit the job instead if you don't want AI notes).

## Requirements for the consuming repo

- **bun** + an Nx workspace using `nx release` with conventional commits.
- Publishable packages under `packages/*/package.json` (the preview helper
  reads this layout) with generated `CHANGELOG.md` files matching
  `changelog-glob`.
- npm **trusted publishing (OIDC)** configured for each package on
  npmjs.com. `release.yml` upgrades npm and sets `registry-url` itself —
  no consumer setup needed beyond the OIDC trust config.
- The draft tag is hardcoded to **`next`** across all three workflows.
- `GITHUB_TOKEN` needs the permissions shown above; nothing else is
  required (no `NPM_TOKEN`, no PAT).

## How the pieces find each other

- The preview uploads `release-preview-body` (the draft markdown) as a
  workflow artifact **unconditionally** — an empty body means "nothing
  pending".
- `release-ai-notes` finds the newest non-expired artifact **by name** (not
  by workflow name — the caller's workflow has its own name) and accepts it
  only when produced by the current run or a completed+successful run on
  the repo's release branch — fork/PR uploads of the same name are
  rejected. The safe-output writer re-checks freshness against the newest
  trusted artifact before writing, so stale highlights are rejected in all
  but a sub-second check-then-write race.
- Reusable callers must chain `ai-notes` with `needs: preview` in the same
  caller workflow so the artifact is in the same run.
