---
name: probe-agy-free
description: 'Engine matrix probe: agy x anyrouter/free'
on:
  workflow_dispatch:
  push:
permissions:
  contents: read
engine:
  id: agy
  model: anyrouter/free
  env:
    GEMINI_API_BASE_URL: 'https://anyrouter.dev/api/v1'
    GEMINI_API_KEY: ${{ secrets.ANYROUTER_API_KEY }}
strict: true
network:
  allowed: [defaults, anyrouter.dev]
tools:
  cli-proxy: true
  bash: ['*']
concurrency:
  group: probe-agy-free
  cancel-in-progress: true
---

# Engine probe

This is an engine-compatibility probe. Do exactly one thing: call the
`noop` safe output exactly once with an empty JSON object, then stop.
Do not do anything else.
