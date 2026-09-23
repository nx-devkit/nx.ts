# @nx-devkit/prepare-for-release

Nx plugin + executor for bootstrapping npm packages: publishes a `0.0.0` placeholder tarball for every workspace package that doesn't exist on the registry yet, so the package name is claimed before you wire up [OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers). Idempotent — already-published packages are skipped.

Part of [nx-devkit](https://github.com/nx-devkit/nx.ts).

## Install

```bash
bun add -D @nx-devkit/prepare-for-release
```

Depends on `@nx/devkit` `^22 || ^23` — installed automatically.

## Bootstrap

Register the plugin in `nx.json`:

```jsonc
{ "plugins": ["@nx-devkit/prepare-for-release"] }
```

That's all — `createNodesV2` infers a `prepare-for-release` target on every non-root `package.json` that has a `name` and is not `private: true`. Then:

```bash
npx nx run-many -t prepare-for-release
```

Each target processes exactly one package; already-published packages skip via `npm view`. Opt a package out with `"private": true`, or exclude project-root prefixes via plugin options:

```jsonc
{ "plugins": [{ "plugin": "@nx-devkit/prepare-for-release", "options": { "exclude": ["fixtures"] } }] }
```

<!-- sym:generators.json → generators.init.factory,schema -->

Alternatively, `npx nx g @nx-devkit/prepare-for-release:init` registers the plugin and creates a legacy `tools` project whose single `prepare-for-release` target scans `packages/*`. When per-package targets are inferred, the tools target is suppressed so `nx run-many -t` never processes a package twice — set `packageTargets: false` in plugin options to keep tools-only mode.

## What the executor does

For each package under `packages/*` (or your `scope` filter):

1. Checks the registry for an existing version of the package.
2. If the name is unclaimed, builds a minimal placeholder tarball **in a temp dir** — your source `package.json` is never mutated.
3. Publishes it with `npm publish --tag placeholder`.
4. Optionally runs `npm trust github` to bind OIDC trusted publishing to your repo.

Already-published packages are skipped on every run. Packages marked `private: true` are ignored entirely — no `npm view`, no publish.

### Interactive auth (EOTP)

When npm demands a one-time password, the executor doesn't leave you guessing: it detects the `EOTP` failure, recovers the real approval URL (npm masks it in non-TTY output), prints it, polls for your approval, and retries with `--otp`. Requires an `npm login` session token in `.npmrc`.

## Options

<!-- option reference consistent with src/executors/publish-placeholder/schema.json -->

```jsonc
// tools/project.json → targets.prepare-for-release.options
{
  "packageJson": "packages/foo/package.json",
  "scope": ["@nx-devkit"],
  "placeholderTag": "placeholder",
  "placeholderVersion": "0.0.0",
  "registry": "https://registry.npmjs.org/",
  "dryRun": false,
  "trust": false,
  "trustRepo": "owner/repo"
}
```

| Option | Default | Effect |
|---|---|---|
| `packageJson` | unset | Process only this manifest (workspace-relative or absolute path). Set automatically by the per-package inferred target; leave unset for the `packages/*` scan. |
| `scope` | every package in `packages/*` | Package scope prefixes to check. |
| `placeholderTag` | `placeholder` | npm dist-tag applied to the placeholder publish. |
| `placeholderVersion` | `0.0.0` | Version written into the temporary placeholder manifest. |
| `registry` | `https://registry.npmjs.org/` | npm registry URL. |
| `dryRun` | `false` | Report what would happen — no `npm pack`, no publish. |
| `trust` | `false` | Run `npm trust github` for every checked package — including already-published (skipped) ones — not just newly published (requires MFA). With `dryRun: true` the trust commands are printed, not run. |
| `trustRepo` | `NPM_TRUST_REPO` or `GITHUB_REPOSITORY` env, else `nx-devkit/nx.ts` | `owner/repo` slug for the `npm trust github` command. |

## Why placeholders

npm OIDC trusted publishing requires the package to already exist before you can configure a trust relationship — but publishing the real package first defeats the point. Placeholders claim the name with throwaway `0.0.0` content under a `placeholder` tag (not `latest`), so users never install a stub by accident. The first real release lands under your normal version.

## Security notes

- The executor invokes `npm` via `spawnSync` with an argv array — no shell interpolation of package names, paths, or registry URLs.
- `npm trust github` runs only when `trust: true` and may prompt for MFA — it's a real-world side effect, not idempotent in the same sense.

## License

MIT
