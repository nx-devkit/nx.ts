# Spec: boundaries

## ADDED Requirements

### Requirement: Root check-boundaries target inference
The plugin MUST infer exactly one `check-boundaries` target on the workspace-root project when at least one non-root project declares `nx.tags` in its `package.json`. A workspace with no tagged projects MUST NOT get the target — a vacuous pass is a false green.

#### Scenario: Tagged workspace gets the target
- **WHEN** at least one project has `"nx": {"tags": [...]}` in `package.json`
- **THEN** the plugin infers a `check-boundaries` target on the root project

#### Scenario: Tagless workspace gets nothing
- **WHEN** no project declares `nx.tags`
- **THEN** no `check-boundaries` target is inferred

### Requirement: Constraint evaluation
For every import specifier in a tagged project's sources that resolves to another workspace project, the executor MUST check each `depConstraint` whose `sourceTag` is in the importing project's tags: the target project MUST share at least one tag with `onlyDependOnLibsWithTags`, else the import is a violation reported as `file:line`.

#### Scenario: Allowed import passes
- **WHEN** `type:app` project imports a `type:feature` project and constraints allow `type:feature`
- **THEN** the executor succeeds

#### Scenario: Forbidden import fails
- **WHEN** `type:feature` project imports a `type:app` project and `type:app` is not in `onlyDependOnLibsWithTags`
- **THEN** the executor exits non-zero and prints `file:line` for the violating import

#### Scenario: Untagged projects are permissive
- **WHEN** a project has no tags
- **THEN** no constraint applies to its imports (permissive default, matching the official ESLint rule)

#### Scenario: Self-imports are allowed
- **WHEN** a project imports another file inside itself
- **THEN** no violation is reported regardless of constraints

### Requirement: Import specifier coverage
The scanner MUST use the TypeScript parser and cover static `import`, `export ... from`, dynamic `import()`, and `require()`; comments and string literals MUST NOT produce false imports.

#### Scenario: Commented import is not a violation
- **WHEN** `// import x from '@acme/app'` appears in a comment
- **THEN** no violation is reported for that line

### Requirement: Specifier resolution order
Specifiers MUST resolve as: relative path → nearest enclosing project; bare workspace package name → that project; tsconfig `paths` match → resolved project; otherwise external (ignored in v1).

#### Scenario: Workspace package-name import resolves
- **WHEN** a file imports `@acme/util` and a project named `@acme/util` exists
- **THEN** the import resolves to that project and constraints are checked
