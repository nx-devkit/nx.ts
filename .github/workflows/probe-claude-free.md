---
name: probe-claude-free
description: 'Engine matrix probe: claude x anyrouter/free'
on:
  workflow_dispatch:
  pull_request:
    types: [opened, synchronize]
permissions:
  contents: read
engine:
  id: claude
  model: anyrouter/free
  env:
    ANTHROPIC_BASE_URL: 'https://anyrouter.dev/api'
    ANTHROPIC_API_KEY: ${{ secrets.ANYROUTER_API_KEY }}
strict: true
network:
  allowed: [defaults, anyrouter.dev]
tools:
  cli-proxy: true
  bash: ['safeoutputs', 'cat']
concurrency:
  group: probe-claude-free
  cancel-in-progress: true
---

# Engine probe

This is an engine-compatibility probe. Do exactly one thing: call the
`noop` safe output exactly once with an empty JSON object, then stop.
Do not do anything else.
