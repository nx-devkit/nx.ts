---
name: probe-pi-free
description: 'Engine matrix probe: pi x anyrouter/free'
on:
  workflow_dispatch:
  push:
    branches: ['probe/**']
permissions:
  contents: read
engine:
  id: pi
  model-provider: openai
  model: anyrouter/free
  env:
    OPENAI_BASE_URL: 'https://anyrouter.dev/api/v1'
    OPENAI_API_KEY: ${{ secrets.ANYROUTER_API_KEY }}
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
  group: probe-pi-free
  cancel-in-progress: true
---

# Engine probe

This is an engine-compatibility probe. Do exactly one thing: run
`safeoutputs probe_ok '{}'` exactly once, then stop.
Do not do anything else.
