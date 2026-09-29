# Delta: knip discovery

## ADDED Requirements

### Requirement: knip config detection

The plugin MUST trigger on `knip.{json,jsonc,ts}`, `knip.config.{ts,js,mjs,cjs}`
and `package.json` files anywhere in the workspace. A `package.json` MUST only
infer targets when it contains a top-level `"knip"` key. Configs inside
`node_modules` or escaping the workspace MUST be skipped.

#### Scenario: standalone config

- **GIVEN** `packages/a/knip.json` exists
- **WHEN** nodes are created
- **THEN** project `packages/a` gets a cached `knip` target running `npx knip` with `cwd = {projectRoot}`

#### Scenario: package.json knip key

- **GIVEN** `packages/a/package.json` contains `"knip": {}`
- **WHEN** nodes are created
- **THEN** project `packages/a` gets the `knip` target

#### Scenario: package.json without knip key

- **GIVEN** `packages/a/package.json` has no `"knip"` key
- **WHEN** nodes are created
- **THEN** no target is inferred for that file

### Requirement: config grouping and precedence

Multiple knip config forms in one directory MUST merge into a single target
pair. All config files in the directory MUST be listed as target inputs so
edits bust the cache.

#### Scenario: knip.json plus knip.ts in one directory

- **GIVEN** a directory contains both `knip.json` and `knip.ts`
- **WHEN** nodes are created
- **THEN** exactly one `knip`/`knip:fix` pair is inferred and both files appear in `inputs`

### Requirement: knip:fix target

When `fixTarget` is enabled (default), the plugin MUST infer a `<targetName>:fix`
target running `npx knip --fix` that MUST NOT be cached.

#### Scenario: fix target inferred

- **GIVEN** a knip config exists
- **WHEN** nodes are created with default options
- **THEN** `knip:fix` exists with `cache: false`

### Requirement: plugin options

`targetName` MUST rename the inferred target pair. `fixTarget: false` MUST
suppress the fix target.

#### Scenario: custom targetName

- **GIVEN** `options.targetName` is `"dead-code"`
- **WHEN** nodes are created
- **THEN** the project gets `dead-code` and `dead-code:fix` instead of `knip`/`knip:fix`
