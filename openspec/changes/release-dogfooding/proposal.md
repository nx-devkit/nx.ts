# Proposal: release-dogfooding

## Why

The repository releases itself with **Nx core's** release machinery:

- `npx nx release version` — the versions, the changelogs and the tags;
- `npx nx release publish` — the OIDC publish and the GitHub Releases.

The repository's own plugin, `@nx-devkit/release`, takes no part in the
release of the repository that ships it. It also only knows a single
package, while the repository publishes twenty of them.

The result is a release flow that cannot be exercised by the plugin it
belongs to, and a plugin whose release capability is not the one the
repository uses.

## What changes

The release becomes **100% nx.ts code**, running from the repository's own
sources — the release is dogfooding.

**Version model** (one version for the whole release, no empty publishes):

- the release carries **one version** for the whole repository — every
  package that is published ends up with it;
- a package whose content is unchanged apart from the version is **not
  published** — it gets no version bump and no tarball;
- the candidate set comes from `nx affected` (the changed packages and
  their dependents);
- the version baseline is the **highest current version** among the
  repository's packages, so no package is ever downgraded.

**Stages** (one PR each):

1. **Versions and changelogs on own code** — conventional commits → semver
   (`feat` → minor, `fix`/`perf`/`revert` → patch, breaking → major), the
   release plan (one version, the changed packages published, the rest
   skipped), per-package changelog entries in the format the repository's
   changelogs already use.
2. **Publish on the local plugin** — a multi-package mode in
   `@nx-devkit/release`, and `release.yml` calls the local target instead
   of `nx release publish`. The dry-run parity check lives here: the same
   packages are published, with the same content — the version differs,
   because the one-version model replaces the per-package versions. The tag
   and the GitHub Release model change here with it.
3. *(optional)* **Split `release.yml` / `publish.yml`** the way adt-cli
   does: the publish is dispatched, because a push from `GITHUB_TOKEN`
   does not cascade into other workflows, and a separate workflow gets
   its own `workflow_ref` for the npm OIDC trust.

## Non-goals

- No change to how a *consumer* releases their project — the plugin's
  single-package mode keeps working.
- The npm OIDC trust stays on `release.yml` unless stage 3 happens.
