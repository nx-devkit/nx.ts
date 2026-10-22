# Tasks: release-dogfooding

## Stage 1 — publish on the local plugin

- [ ] `@nx-devkit/release`: a multi-package mode (publish the given
      packages with one version, one tag, one GitHub Release)
- [ ] `release.yml` calls the local target instead of `nx release publish`
- [ ] Dry-run parity against the current `main` (the same published set,
      the same versions) — the tag and GitHub Release model change in
      stage 2, together with the one-version model

## Stage 2 — versions and changelogs on own code

- [ ] Conventional commit → semver: `feat` → minor,
      `fix`/`perf`/`revert` → patch, breaking → major, everything else →
      no release
- [ ] One version for the release (the baseline is the highest current
      version among the packages); a package unchanged apart from the
      version is not published
- [ ] The candidate set comes from `nx affected`
- [ ] Changelog entries in the format the repository's changelogs use

## Stage 3 — split release/publish (optional)

- [ ] `publish.yml` dispatched after the release push
- [ ] npm trust re-registered on `publish.yml`
