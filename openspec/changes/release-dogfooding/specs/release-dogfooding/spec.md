# release-dogfooding

## ADDED Requirements

### Requirement: conventional commits decide the release version

The release version MUST be derived from the conventional commits since the
previous release: a `feat` commit implies a minor bump, a `fix`, `perf` or
`revert` commit implies a patch bump, a commit marked breaking (a `!` after
the type or scope, or a `BREAKING CHANGE:` footer) implies a major bump, and
commits of any other type imply no release. When no commit in the range
implies a release, no version MUST be produced and the release MUST be
skipped.

#### Scenario: a feature commit

- **GIVEN** the commits since the last release contain `feat: add a target`
- **WHEN** the release version is derived
- **THEN** the version is bumped by a minor

#### Scenario: a fix commit

- **GIVEN** the commits since the last release contain `fix: stop the leak`
- **WHEN** the release version is derived
- **THEN** the version is bumped by a patch

#### Scenario: a breaking change

- **GIVEN** the commits since the last release contain `feat!: drop the old option`
- **WHEN** the release version is derived
- **THEN** the version is bumped by a major

#### Scenario: nothing releasable

- **GIVEN** the commits since the last release contain only `docs:` and `chore:` commits
- **WHEN** the release version is derived
- **THEN** no version is produced and the release is skipped

### Requirement: one version for the release

A release MUST carry one version for the whole repository. Every package
that is published in that release MUST end up with that version; a package
that is not published MUST keep its version. The version baseline MUST be
the highest current version among the repository's packages, so that no
package is ever downgraded.

#### Scenario: two packages change

- **GIVEN** two packages changed since the last release
- **WHEN** the release runs
- **THEN** both packages are published with the same version

### Requirement: unchanged packages are not published

A package whose content is unchanged apart from its version MUST NOT be
published, MUST NOT get a version bump and MUST NOT produce a changelog
entry. The candidate set comes from the affected graph (the changed
packages and their dependents); the unchanged ones are dropped from it.

#### Scenario: a package that only changed through a dependent

- **GIVEN** a package's source did not change and its dependency's range did not change
- **WHEN** the release runs
- **THEN** the package is not published and keeps its version

#### Scenario: a package whose source changed

- **GIVEN** a package's source changed since the last release
- **WHEN** the release runs
- **THEN** the package is published with the release version

#### Scenario: a skipped package is reported

- **GIVEN** a package whose content did not change
- **WHEN** the release runs
- **THEN** the package is listed as skipped, with the reason it was not published

### Requirement: the changelog follows the repository's format

The changelog entry of a release MUST use the format the repository's
changelogs already use:

- a `## <version> (<date>)` heading;
- the changes grouped by type under the matching emoji heading
  (`### 🚀 Features`, `### 🩹 Fixes`, `### ⚡ Performance Improvements`,
  `### ⏪ Reverts`, `### 📦 Other`);
- one bullet per change: `- **<scope>:** <description> ([#<pr>](<url>))`,
  with a `**⚠ BREAKING CHANGE:**` marker on a breaking change;
- a `### ❤️ Thank You` section listing the contributors as
  `- <name> @<handle>`.

#### Scenario: a feature and a fix

- **GIVEN** a release with a `feat` and a `fix` commit
- **WHEN** the changelog is rendered
- **THEN** the feature is listed under the features heading and the fix under the fixes heading
