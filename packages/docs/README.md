# @nx-devkit/docs

Standalone Nx plugin: a `.vitepress/config.*` or `astro.config.*` (including [Starlight](https://starlight.astro.build/) sites) becomes a `docs:*` target set on the owning project. No `project.json` needed.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/docs vitepress   # or: bun add -D @nx-devkit/docs astro
```

Depends on `@nx/devkit` `^24`. `vitepress` (`^1 || ^2`) and `astro` (`^4 || ^5`) are optional peers — install the one(s) your site uses. Starlight sites need `astro` + `@astrojs/starlight`.

## Register

```bash
nx add @nx-devkit/docs   # runs the init generator — registers the plugin in nx.json
```

Or manually:

```jsonc
// nx.json
{ "plugins": ["@nx-devkit/docs"] }
```

The init generator also installs the matching peer (`vitepress` and/or `astro`) when it finds the corresponding config file in the workspace.

## What it infers

<!-- target table consistent with src/plugin.ts createNodesV2 -->

| Trigger               | Target         | Command                 | Cacheable | Continuous |
| --------------------- | -------------- | ----------------------- | --------- | ---------- |
| `.vitepress/config.*` | `docs:dev`     | `npx vitepress dev`     | no        | yes        |
| same                  | `docs:build`   | `npx vitepress build`   | yes       | no         |
| same                  | `docs:preview` | `npx vitepress preview` | no        | yes        |
| `astro.config.*`      | `docs:dev`     | `npx astro dev`         | no        | yes        |
| same                  | `docs:build`   | `npx astro build`       | yes       | no         |
| same                  | `docs:preview` | `npx astro preview`     | no        | yes        |

- `cwd` is `{projectRoot}` — vitepress/astro auto-discover their config from the owning directory.
- `.vitepress/config.*` maps to the **parent** of `.vitepress` (`docs/.vitepress/config.ts` → project `docs`).
- `docs:dev` and `docs:preview` are `continuous` (Nx 21+), so other targets can depend on them; `docs:preview` `dependsOn` `docs:build`.
- `docs:build` outputs: `{projectRoot}/.vitepress/dist` + `{projectRoot}/dist` for vitepress (covers the default and a `outDir: 'dist'` override), `{projectRoot}/dist` for astro. A literal `outDir: '…'` in the config is sniffed and added too, so a custom output survives a cache hit (a computed `outDir` can't be detected — declare it via `outputs` in `project.json`/`package.json` if needed). Build outputs, `.vitepress/cache`, `.astro`, and `node_modules` are negated from inputs so a previous build cannot poison the next hash.
- An `astro.config.*` that imports `@astrojs/starlight` is reported with `metadata.technologies: ['astro', 'starlight']` — same `astro` commands.
- A project root holding both an astro and a vitepress config resolves to **astro**.

## Options

```jsonc
// nx.json
{
  "plugins": [
    {
      "plugin": "@nx-devkit/docs",
      "options": {
        "targetPrefix": "docs", // rename the target set → site:dev etc.
      },
    },
  ],
}
```

## Inspect

```bash
npx nx show project my-docs         # see inferred targets
npx nx run-many -t docs:build       # build every docs site in the workspace
npx nx run my-docs:docs:dev         # start the dev server (continuous)
```
