# init-peer-deps

## ADDED Requirements

### Requirement: Peer dependency installation on init

Each standalone plugin init generator SHALL install its declared tool dependency into the consumer's `devDependencies` when missing.

#### Scenario: Fresh consumer workspace

- **WHEN** `nx add @nx-devkit/knip` runs the init generator in a workspace without `knip` in dependencies or devDependencies
- **THEN** the generator adds `knip` to devDependencies with the plugin's peer range

#### Scenario: Dependency already present

- **WHEN** the consumer already declares the tool in dependencies or devDependencies
- **THEN** the generator leaves the existing entry untouched

### Requirement: Shared installer helper

`@nx-devkit/internal` SHALL export `installPeerDeps(tree, deps)` returning a GeneratorCallback that writes missing entries via `addDependenciesToPackageJson` and no-ops when all are present.

#### Scenario: Empty delta

- **WHEN** all requested deps already exist in the consumer package.json
- **THEN** the callback performs no write and resolves cleanly
