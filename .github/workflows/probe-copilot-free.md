---
name: probe-copilot-free
description: 'Engine matrix probe: copilot x anyrouter/free'
on:
  workflow_dispatch:
  push:
permissions:
  contents: read
engine:
  id: copilot
  env:
    COPILOT_PROVIDER_BASE_URL: 'https://anyrouter.dev/api/v1'
    COPILOT_PROVIDER_TYPE: openai
    COPILOT_PROVIDER_WIRE_API: completions
    COPILOT_MODEL: anyrouter/free
    COPILOT_PROVIDER_API_KEY: ${{ secrets.ANYROUTER_API_KEY }}
strict: true
network:
  allowed: [defaults, anyrouter.dev]
tools:
  cli-proxy: true
  bash: ['safeoutputs', 'cat']
concurrency:
  group: probe-copilot-free
  cancel-in-progress: true
---

# Engine probe

This is an engine-compatibility probe. Do exactly one thing: call the
`noop` safe output exactly once with an empty JSON object, then stop.
Do not do anything else.
