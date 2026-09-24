# Tasks: boundary-enforcement

## Spec & scaffold

- [ ] `packages/boundaries/` skeleton: package.json (name `@nx-devkit/boundaries`, devkit dep `^22 || ^23`, repository/bugs/homepage metadata), tsdown.config.ts, tsconfig.json, vitest.config.ts, executors.json, README.md, AGENTS.md
- [ ] Register in root workspace (nx.json/package.json workspace globs should pick it up — verify `nx show projects`)

## Plugin (inference)

- [ ] `src/plugin.ts`: `createNodesV2` on `**/package.json`, emit root `check-boundaries` target only when ≥1 project declares `nx.tags`
- [ ] `src/plugin.spec.ts`: tagless workspace → no target; tagged workspace → exactly one root target; node_modules/root-skip rules

## Executor

- [ ] `src/tags.ts`: project → tags extraction from graph nodes
- [ ] `src/imports.ts`: TS-parser scanning (static import, export-from, dynamic import, require) — spec: comments/strings don't produce false imports
- [ ] `src/resolve.ts`: relative → project, bare workspace name → project, tsconfig paths → project, external → ignore
- [ ] `src/constraints.ts`: depConstraints evaluation, permissive untagged default, self-imports allowed
- [ ] `src/executors/check-boundaries/executor.ts`: wire it together, violations → `file:line` report + non-zero exit
- [ ] Executor specs: allow, deny, untagged permissive, self-import, cycle-free subset

## Verify

- [ ] `bun run build`, `bun run test`, `bun run lint` clean
- [ ] `bun run check:spec` no target conflicts
- [ ] `bunx openspec validate boundary-enforcement --strict`
- [ ] Packed e2e: consumer with 2 tagged packages + violating import → target fails; fix → passes
