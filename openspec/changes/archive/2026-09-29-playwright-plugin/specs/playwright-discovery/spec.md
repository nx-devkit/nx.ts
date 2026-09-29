# Delta: playwright discovery

## ADDED Requirements

### Requirement: playwright config detection

The plugin MUST trigger on `playwright.config.{ts,js,mts,mjs,cjs,cts}` files
anywhere in the workspace. Configs inside `node_modules` or escaping the
workspace MUST be skipped.

#### Scenario: nested config

- **GIVEN** `apps/web/playwright.config.ts` exists
- **WHEN** nodes are created
- **THEN** project `apps/web` gets a cached `e2e` target running `npx playwright test` with `cwd = {projectRoot}` and outputs `test-results`, `playwright-report`, `blob-report`

### Requirement: extra targets

The plugin MUST infer `<targetName>:ui` (`--ui`) and
`<targetName>:update-snapshots` (`--update-snapshots`) targets that MUST NOT be
cached, unless `extraTargets: false`.

#### Scenario: extra targets inferred

- **GIVEN** a playwright config exists
- **WHEN** nodes are created with default options
- **THEN** `e2e:ui` and `e2e:update-snapshots` exist with `cache: false`

#### Scenario: extraTargets disabled

- **GIVEN** `options.extraTargets` is `false`
- **WHEN** nodes are created
- **THEN** only `e2e` is inferred

### Requirement: plugin options

`targetName` MUST rename the inferred target set.

#### Scenario: custom targetName

- **GIVEN** `options.targetName` is `"browser-test"`
- **WHEN** nodes are created
- **THEN** the project gets `browser-test`, `browser-test:ui`, `browser-test:update-snapshots`
