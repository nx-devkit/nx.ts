# @nx-devkit/deploy

Zero-config Nx plugin: a provider config file in your workspace automatically produces `deploy` (and, where supported, `dev`) targets — no `project.json` needed.

## Install

```bash
nx add @nx-devkit/deploy
```

The init generator registers the plugin in `nx.json`. It installs nothing else — deploy CLIs are provider-specific and often installed globally, so you install whichever ones your projects use (`wrangler`, `flyctl`, `vercel`, `netlify-cli`).

## Usage

Any directory containing a provider config gets targets on the owning project — including the workspace root (single-app repos deploy from the repo root). When several provider configs coexist in one directory, the first match in a deterministic precedence wins: `wrangler.toml` → `fly.toml` → `vercel.json` → `netlify.toml`.

| Config file     | Inferred targets                                                    |
| --------------- | ------------------------------------------------------------------- |
| `wrangler.toml` | `deploy` (`wrangler deploy`), `dev` (`wrangler dev`, continuous)    |
| `fly.toml`      | `deploy` (`flyctl deploy`)                                          |
| `vercel.json`   | `deploy` (`vercel deploy --prod`), `dev` (`vercel dev`, continuous) |
| `netlify.toml`  | `deploy` (`netlify deploy --prod`)                                  |

```bash
nx run my-app:deploy         # ship to the provider
nx run my-app:dev            # wrangler/vercel local dev server (continuous)
nx run-many -t deploy        # every project with a provider config
```

All deploy targets are **`cache: false`** — a deploy is a side effect against a provider, never a cacheable verdict. `dev` targets are **`continuous: true`** — dependents can gate on them via `waitFor` in `dependsOn`.

When the project declares a build — a `build` script in `package.json` (materialised as a target by `nx/core/package-json`) or a `build` target in `project.json` — the deploy target gains `dependsOn` on that build so artifacts ship fresh. `dependsOn` is omitted when no build exists, so the target never references a missing task.

## Secrets

Credentials travel **strictly via environment variables** — nothing secret is ever interpolated into the command line. Set the provider token in your shell or CI secret store:

| Provider   | Environment variables                   |
| ---------- | --------------------------------------- |
| Cloudflare | `CLOUDFLARE_API_TOKEN`                  |
| Fly.io     | `FLY_API_TOKEN`                         |
| Vercel     | `VERCEL_TOKEN`                          |
| Netlify    | `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID` |

## Options

Register with options in `nx.json`:

```jsonc
{
  "plugins": [
    {
      "plugin": "@nx-devkit/deploy",
      "options": {
        "deployTargetName": "deploy", // default "deploy"
        "devTargetName": "dev", // default "dev"
      },
    },
  ],
}
```

| Option             | Default  | Description                                             |
| ------------------ | -------- | ------------------------------------------------------- |
| `deployTargetName` | `deploy` | Target name for the provider deploy command.            |
| `devTargetName`    | `dev`    | Target name for the local dev server (wrangler/vercel). |

## License

MIT
