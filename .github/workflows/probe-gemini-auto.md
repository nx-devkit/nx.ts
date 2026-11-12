---
name: probe-gemini-auto
description: 'Engine matrix probe: gemini x anyrouter/auto'
on:
  workflow_dispatch:
  pull_request:
    types: [opened, synchronize]
permissions:
  contents: read
engine:
  id: gemini
  model: anyrouter/auto
  env:
    GEMINI_API_BASE_URL: 'https://anyrouter.dev/api/v1'
    GEMINI_API_KEY: ${{ secrets.ANYROUTER_API_KEY }}
strict: true
network:
  allowed: [defaults, anyrouter.dev]
tools:
  cli-proxy: true
  bash: ['safeoutputs', 'cat']
concurrency:
  group: probe-gemini-auto
  cancel-in-progress: true
---

# Engine probe

This is an engine-compatibility probe. Do exactly one thing: call the
`noop` safe output exactly once with an empty JSON object, then stop.
Do not do anything else.
