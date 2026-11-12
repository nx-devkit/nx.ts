---
name: release-ai-notes
description: "Prepends AI-generated release highlights to the 'next' draft release after release-preview updates it"
on:
  workflow_run:
    workflows: ["release-preview"]
    types: [completed]
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  copilot-requests: write
engine:
  id: copilot
strict: true
network:
  allowed: [defaults, github]
tools:
  github:
    # repos covers releases — the agent only reads the draft body
    toolsets: [repos]
  cli-proxy: true
  bash: ["safeoutputs", "cat"]
safe-outputs:
  update-release:
concurrency:
  group: release-ai-notes
  cancel-in-progress: true
if: >-
  github.event_name == 'workflow_dispatch' ||
  github.event.workflow_run.conclusion == 'success'
---

# Release AI Notes

You maintain the human-facing summary of the pending release shown in the draft GitHub release tagged `next`.

## Steps

1. Fetch the release tagged `next` with the GitHub tools (get release by tag). It is a **draft** maintained by the `release-preview` workflow; its body lists pending version bumps and per-package changelog sections.
2. If no release exists for tag `next`, or its body is empty, take no action — use the noop safe-output call for this case.
3. Write a `## Highlights` section in Markdown:
   - One-line overall summary at the top, then 3–6 bullets maximum.
   - Each bullet describes what users actually get — new plugins, fixes, behavior changes — not version numbers, tags, or process details.
   - Infer package purpose from names (e.g. `@nx-devkit/openspec` → OpenSpec tooling) and the changelog text. **Do not invent changes that are not described in the body.**
   - Skip packages listed as "version bumps only" with no code changes, unless they are the only content.
   - Tone: concise release notes for developers. No emojis, no mention of AI or automation.
4. Submit exactly one safe-output call:

   ```
   safeoutputs update_release '{"type":"update_release","tag":"next","operation":"prepend","body":"## Highlights\n\n<summary>\n\n- <bullet>\n- <bullet>"}'
   ```

   `prepend` puts the section above the mechanical preview content. Encode newlines as `\n` inside the JSON string.
