# Tasks: release-dogfooding

## Stage 1 — versions and changelogs on own code

- [x] Conventional commit → semver: `feat` → minor,
      `fix`/`perf`/`revert` → patch, breaking → major, everything else →
      no release
- [x] The release plan: one version for the release, the packages whose
      content changed are published, the rest are skipped with a reason,
      the contributors are part of the plan's input
- [x] Changelog entries in the format the repository's changelogs use
- [ ] The candidate set comes from `nx affected`
- [ ] The plan is applied: the manifests, the changelogs, the tag, the
      GitHub Release

## Stage 2 — publish on the local plugin

- [ ] `@nx-devkit/release`: a multi-package mode (publish the given
      packages with one version, one tag, one GitHub Release)
- [ ] `release.yml` calls the local target instead of `nx release publish`
- [ ] Dry-run parity against the current `main`: the same packages are
      published, with the same content — the version differs, because the
      one-version model replaces the per-package versions. The tag and the
      GitHub Release model change here with it

## Stage 3 — split release/publish (optional)

- [ ] `publish.yml` dispatched after the release push
- [ ] npm trust re-registered on `publish.yml`
