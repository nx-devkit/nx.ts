# eslint-discovery Specification

## Purpose

How `@nx-devkit/eslint` discovers flat configs and infers `lint`/`lint:fix` targets on the owning project.

## Requirements

### Requirement: eslint flat-config detection

The plugin MUST trigger on `eslint.config.{js,mjs,cjs,ts,mts,cts}` files
anywhere in the workspace. Legacy `.eslintrc.*` files MUST NOT trigger.
Configs inside `node_modules` or escaping the workspace MUST be skipped.

#### Scenario: flat config at workspace root

- **GIVEN** `eslint.config.mjs` exists at the workspace root
- **WHEN** nodes are created
- **THEN** the root project gets a cached `lint` target running `npx eslint .` with `cwd = {projectRoot}`

#### Scenario: nested config

- **GIVEN** `packages/a/eslint.config.mjs` exists
- **WHEN** nodes are created
- **THEN** project `packages/a` gets the `lint` target

### Requirement: lint:fix target

When `fixTarget` is enabled (default), the plugin MUST infer a
`<targetName>:fix` target running `npx eslint . --fix` that MUST NOT be cached.

#### Scenario: fix target inferred

- **GIVEN** an eslint config exists
- **WHEN** nodes are created with default options
- **THEN** `lint:fix` exists with `cache: false`

### Requirement: plugin options

`targetName` MUST rename the inferred target pair. `fixTarget: false` MUST
suppress the fix target.

#### Scenario: custom targetName

- **GIVEN** `options.targetName` is `"eslint"`
- **WHEN** nodes are created
- **THEN** the project gets `eslint` and `eslint:fix` instead of `lint`/`lint:fix`
