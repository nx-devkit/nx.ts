---
name: probe-claude-auto
description: 'Engine matrix probe: claude x anyrouter/auto'
on:
  workflow_dispatch:
  push:
    branches: ['probe/**']
permissions:
  contents: read
engine:
  id: claude
  model: anyrouter/auto
  env:
    ANTHROPIC_BASE_URL: 'https://anyrouter.dev/api'
    ANTHROPIC_API_KEY: ${{ secrets.ANYROUTER_API_KEY }}
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
  group: probe-claude-auto
  cancel-in-progress: true
---

# Engine probe

This is an engine-compatibility probe. Do exactly one thing: use
your shell/bash tool to run this exact command once:

    safeoutputs probe_ok '{}'

Then stop. Do not do anything else.
