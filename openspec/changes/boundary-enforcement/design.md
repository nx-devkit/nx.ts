# Design: `@nx-devkit/boundaries`

## Package shape

```
packages/boundaries/
├── package.json              # @nx-devkit/boundaries
├── executors.json            # check-boundaries executor
├── src/
│   ├── index.ts              # createNodesV2 + executor exports
│   ├── plugin.ts             # infers root check-boundaries target
│   ├── tags.ts               # collect project -> tags from graph
│   ├── imports.ts            # TS-parser import scanning
│   ├── resolve.ts            # specifier -> project resolution
│   ├── constraints.ts        # depConstraints evaluation
│   └── executors/check-boundaries/{executor.ts,schema.json}
```

## Inference trigger

The plugin registers on `**/package.json` but emits **one** `check-boundaries` target on the workspace-root project only — boundaries are graph-global, per-project targets would duplicate work and produce partial answers.

Target inferred only when at least one non-root project has `nx.tags` — a tagless workspace has nothing to constrain, and silently passing would be a false green.

## Tags

Consumers declare tags in each package's `package.json`:

```jsonc
{ "name": "@acme/web", "nx": { "tags": ["type:app", "scope:shop"] } }
```

Nx merges this into the project node regardless of how the project was inferred — this is the same metadata channel `project.json` `tags` uses, so `nx show project` displays them identically.

## Import scanning

TypeScript compiler API over regexes — regexes choke on comments, template literals, and `export * from`. For each `SourceFile` collect: static `import`/`export ... from`, `import()` expressions, `require()` calls. Source-file set: `**/*.{ts,tsx,mts,cts,js,mjs,cjs}` under the project root, minus `node_modules`, `dist`, `*.d.ts`, and test files? — **no**: test files import too and violations there are still violations. Include them.

## Resolution

Order per specifier:
1. Relative specifier → resolve against importing file → walk up to nearest project root.
2. Bare specifier matching a workspace package name (`package.json` `name` of a project) → that project.
3. tsconfig `paths` match → resolve → nearest project root.
4. Otherwise → external npm package → ignored in v1.

## Constraint evaluation

```
for each (sourceProject, import, targetProject):
  for each constraint where sourceTag ∈ sourceProject.tags:
    if targetProject.tags ∩ onlyDependOnLibsWithTags = ∅ → violation
```

Self-imports (source == target project) always allowed. Projects with no tags: unconstrained (permissive) — matches the official rule's default; a `strictUntagged` option can come later if requested.

## Options

```ts
export interface NxBoundariesOptions {
  depConstraints?: DepConstraint[];   // [{sourceTag, onlyDependOnLibsWithTags}]
  targetName?: string;                // default "check-boundaries"
}
```

## Performance

Graph + one pass of `ts.createSourceFile` per file. For a mid-size monorepo (~1k files) this is single-digit seconds; cacheable as an Nx target keyed on source + package.json inputs. No incremental mode in v1 — `affected` already bounds how often it runs.
