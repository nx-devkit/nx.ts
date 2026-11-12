---
name: probe-codex-free
description: 'Engine matrix probe: codex x anyrouter/free'
on:
  workflow_dispatch:
permissions:
  contents: read
engine:
  id: codex
  model: anyrouter/free
  env:
    OPENAI_BASE_URL: 'https://anyrouter.dev/api/v1'
    OPENAI_API_KEY: ${{ secrets.ANYROUTER_API_KEY }}
strict: true
network:
  allowed: [defaults, anyrouter.dev]
tools:
  cli-proxy: true
  bash: ['*']
concurrency:
  group: probe-codex-free
  cancel-in-progress: true
---

# Engine probe

This is an engine-compatibility probe. Do exactly one thing: call the
`noop` safe output exactly once with an empty JSON object, then stop.
Do not do anything else.
