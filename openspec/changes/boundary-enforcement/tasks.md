# Tasks: boundary-enforcement

## Spec & scaffold

- [ ] `packages/boundaries/` skeleton: package.json (name `@nx-devkit/boundaries`, devkit dep `^22 || ^23`, repository/bugs/homepage metadata), tsdown.config.ts, tsconfig.json, vitest.config.ts, executors.json, README.md, AGENTS.md
- [ ] Register in root workspace: `package.json` workspaces glob picks up the package, but `createNodesV2` only runs for plugins listed in `nx.json` `plugins` — add `./packages/boundaries/src/plugin.ts` (matching `packages/diagrams`), then verify `nx show projects`

## Plugin (inference)

- [ ] `src/plugin.ts`: `createNodesV2` on `**/package.json`, emit root `check-boundaries` target only when ≥1 project declares `nx.tags`
- [ ] `src/plugin.spec.ts`: tagless workspace → no target; tagged workspace → exactly one root target; node_modules/root-skip rules; input-order determinism — the same `**/package.json` set supplied in different orders produces identical `createNodesV2` output

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
- [ ] Packed e2e: consumer with 2 tagged packages + violating import → target fails; fix → passes. Set `NX_DAEMON=false` in the consumer so the persistent daemon can't race teardown cleanup
