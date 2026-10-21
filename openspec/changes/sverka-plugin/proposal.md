# Proposal: sverka-plugin

## Why

A sverka config is the source of truth for a repository's checks: it defines
pipelines, steps and entries, and it compiles to CI YAML. Locally, though,
running a sverka workflow means running the *whole* entry — one command, no
per-step caching, no affected-file detection, no parallelism.

An Nx integration fixes that: the config's steps become Nx targets, so each
step keeps its own inputs, outputs and cache entry, Nx runs them in
dependency order and restores a single step from the cache without re-running
the steps before it.

## What changes

- New package `@nx-devkit/sverka` under `packages/sverka/`.
- `createNodesV2` watches sverka configs (`sverka.config.{ts,mts,js,mjs}`).
  The config's directory becomes the owning project; **every step** the
  selected entries can reach becomes a target of its own (`<pipeline>:<step>`,
  e.g. `ci:lint`).
- Sverka step dependencies become Nx `dependsOn`; the artifacts a step
  consumes become its `inputs`; the files a step declares as outputs become
  its `outputs`; every target is `cache: true`.
- New executor `@nx-devkit/sverka:step` runs **one** sverka step through the
  sverka engine, with an artifact/value bridge that moves data across the
  task boundary (the engine's artifact store lives inside a single run).
- New generator `@nx-devkit/sverka:config` writes a `sverka.config.ts` from
  what the project already has (package.json scripts, Nx targets) and can add
  GitHub-side checks (GraphQL review debt, advanced security, secret
  scanning, …) to a `repo-health` pipeline.
- New generator `@nx-devkit/sverka:init` registers the plugin and installs
  `@sverka/workflow`.

## Non-goals

- No sverka runtime feature is reimplemented — the step runs on the sverka
  engine, so agent steps, secrets, reports and runtime modes keep working.
- No sverka CI compilation — `sverka compile` stays the way to produce CI
  YAML.
- No changes to sverka itself.
