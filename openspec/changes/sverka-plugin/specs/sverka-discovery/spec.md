# sverka-discovery

## ADDED Requirements

### Requirement: sverka config discovery

The plugin SHALL watch sverka config files matching
`**/{sverka.config.ts,sverka.config.mts,sverka.config.js,sverka.config.mjs}`
via `createNodesV2`. The directory containing the config SHALL become the
owning project. A config that cannot be loaded MUST NOT break the project
graph — the plugin SHALL warn and skip it.

#### Scenario: config at the workspace root

- **WHEN** `sverka.config.ts` exists at the workspace root
- **THEN** the root project gains one target per sverka step

#### Scenario: config in a nested package

- **WHEN** `packages/app/sverka.config.ts` exists
- **THEN** project `packages/app` gains one target per sverka step

#### Scenario: config that fails to load

- **WHEN** the config cannot be loaded
- **THEN** no target is inferred for it and the project graph is still built

### Requirement: one target per step

Every step the selected entries can reach MUST become a target of its own,
named `<pipeline>:<step>` by default. The steps of an entry MUST NOT be
collapsed into a single target.

#### Scenario: steps of one entry

- **GIVEN** an entry with the steps `ci/lint` and `ci/test`
- **WHEN** nodes are created
- **THEN** the project gains the targets `ci:lint` and `ci:test`

#### Scenario: custom target name

- **GIVEN** the option `targetName` is `"sverka-{step}"`
- **WHEN** nodes are created
- **THEN** the project gains the targets `sverka-lint` and `sverka-test`

#### Scenario: single entry

- **GIVEN** the option `entry` is `"ci/on-push"`
- **WHEN** nodes are created
- **THEN** only the steps that entry can reach are inferred

### Requirement: per-step inputs, outputs and cache

Every inferred target MUST be cached by default (`cache: true`) and MUST declare
its own inputs and outputs. The `cache: false` option MUST be honored. A
step that reads remote state (a command that talks to GitHub) MUST NOT be
cached — its result depends on state Nx cannot hash. The inputs MUST cover
the project files, the sverka config and the artifacts the step consumes;
the outputs MUST cover the files the step declares as outputs.

#### Scenario: cached target

- **WHEN** nodes are created
- **THEN** every inferred target has `cache: true`

#### Scenario: declared output

- **GIVEN** a step declares the output `eslint.sarif` (from stdout)
- **WHEN** nodes are created
- **THEN** the target declares `.sverka/artifacts/<stepId>/eslint.sarif` as
  its output

#### Scenario: consumed artifact

- **GIVEN** a step consumes the artifact `eslint.sarif` of another step
- **WHEN** nodes are created
- **THEN** the target declares the producer's artifact path as its input

#### Scenario: no self-invalidation

- **GIVEN** a step writes a file into the project
- **WHEN** nodes are created
- **THEN** a *detectable* write MUST be excluded from the inputs of every
  step of the config, so a step does not invalidate its own cache

The detectable writes are the declared outputs, the imported artifacts (the
engine materializes them in the project directory) and the files a shell
step redirects into (`tool > report.txt`). A file a step writes without any
of those declarations stays an input — declare it in the sverka config.

### Requirement: step dependencies become target dependencies

A sverka step dependency (`control`, `value` or `artifact`) MUST become a
`dependsOn` entry on the consuming target, pointing at the producer's target.

#### Scenario: dependent steps

- **GIVEN** the step `ci/test` depends on `ci/lint`
- **WHEN** nodes are created
- **THEN** the target `ci:test` declares `dependsOn: ["ci:lint"]`

### Requirement: the step executor runs exactly one step

The executor `@nx-devkit/sverka:step` MUST run the step named by its
`step` option and nothing else. The sverka engine MUST receive a plan with
that single step, without the step's dependency edges — Nx ran the
producing tasks already.

#### Scenario: running a step

- **WHEN** the executor runs the step `ci/lint`
- **THEN** only that step's command runs in the project directory

#### Scenario: unknown step

- **WHEN** the executor runs a step that is not in the config
- **THEN** it fails with an error naming the step

#### Scenario: failing step

- **WHEN** the step's command exits non-zero
- **THEN** the executor reports the failure and the task fails

### Requirement: artifacts cross the task boundary

The executor MUST materialize an imported artifact in the project directory
before the step runs, and MUST publish the step's own artifacts and values
to stable paths afterwards — the sverka engine keeps artifacts in a per-run
store that does not exist in another task.

#### Scenario: consuming an artifact

- **GIVEN** the step `ci/policy` imports the artifact `eslint.sarif`
- **WHEN** the producing step ran before it
- **THEN** the artifact is available to the step and the step succeeds

#### Scenario: missing artifact

- **GIVEN** the producing step did not run
- **WHEN** the consuming step runs
- **THEN** the executor fails with an error naming the missing artifact

#### Scenario: publishing an artifact

- **WHEN** a step declares a stdout artifact
- **THEN** the artifact is written to `.sverka/artifacts/<stepId>/<name>` in
  the project directory

#### Scenario: publishing a value

- **WHEN** a step declares a value output
- **THEN** the value is written to `.sverka/artifacts/<stepId>/values/<name>`
  and a consuming step interpolates it

### Requirement: config generation

The generator `@nx-devkit/sverka:config` MUST write a `sverka.config.ts` from
what the project already has: its `package.json` scripts and its Nx targets.
It MUST refuse to overwrite an existing config unless `force` is set.

#### Scenario: scripts become steps

- **GIVEN** the project has the scripts `lint` and `test`
- **WHEN** the generator runs
- **THEN** the config contains a `lint` and a `test` step running them

#### Scenario: Nx target becomes a step

- **GIVEN** the project has an Nx target `lint` and no `lint` script
- **WHEN** the generator runs
- **THEN** the config contains a `lint` step running that target

#### Scenario: existing config

- **GIVEN** a `sverka.config.ts` already exists
- **WHEN** the generator runs without `force`
- **THEN** it fails and the file is left untouched

### Requirement: GitHub-side checks

The config generator MUST be able to add GitHub-side checks to a
`repo-health` pipeline. The available checks MUST be `main-green`,
`review-debt` (GraphQL), `dependabot-alerts`, `code-scanning`,
`secret-scanning`, `stale-branches` and `open-prs`.

#### Scenario: review debt

- **GIVEN** the option `githubChecks` includes `review-debt`
- **WHEN** the generator runs
- **THEN** the config contains a `repo-health` pipeline with a `review-debt`
  step that queries the GitHub GraphQL API
