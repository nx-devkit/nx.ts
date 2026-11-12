---
name: probe-copilot-auto
description: 'Engine matrix probe: copilot x anyrouter/auto'
on:
  workflow_dispatch:
  push:
    branches: ['probe/**']
permissions:
  contents: read
engine:
  id: copilot
  env:
    COPILOT_PROVIDER_BASE_URL: 'https://anyrouter.dev/api/v1'
    COPILOT_PROVIDER_TYPE: openai
    COPILOT_PROVIDER_WIRE_API: completions
    COPILOT_MODEL: anyrouter/auto
    COPILOT_PROVIDER_API_KEY: ${{ secrets.ANYROUTER_API_KEY }}
strict: true
network:
  allowed: [defaults, anyrouter.dev]
tools:
  cli-proxy: true
  bash: ['safeoutputs', 'cat']
safe-outputs:
  jobs:
    probe-ok:
      description: 'Probe heartbeat — proves the safe-output path works'
      runs-on: ubuntu-latest
      output: 'probe ok'
      permissions:
        contents: read
      steps:
        - run: echo "probe-ok received"
concurrency:
  group: probe-copilot-auto
  cancel-in-progress: true
---

# Engine probe

This is an engine-compatibility probe. Do exactly one thing: run
`safeoutputs probe_ok '{}'` exactly once, then stop.
Do not do anything else.
