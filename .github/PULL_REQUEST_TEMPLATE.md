## What

<!-- One paragraph: what changed and why. Link the issue/bead if there is one. -->

## Scope

<!-- One package per PR. Which packages/* directories does this touch? -->

## Verification

- [ ] `bun install`
- [ ] `bun run lint`
- [ ] `bun test`
- [ ] `bun run build`
- [ ] `bash scripts/e2e.sh` (if plugin inference changed)
- [ ] `bun run check:spec` and `bunx openspec validate` (if specs changed)

## Notes for reviewers

<!-- Trade-offs, follow-ups, anything intentionally out of scope. -->
