---
safe-outputs:
  jobs:
    update-next-release:
      description: "Prepend a Highlights section to the 'next' draft release — the only release this job can touch"
      runs-on: ubuntu-latest
      output: 'Highlights prepended to the next draft release'
      permissions:
        contents: write
        actions: read
      inputs:
        body:
          description: 'Markdown Highlights section to prepend to the release body'
          required: true
          type: string
        preview_run:
          description: 'ID of the release-preview run whose artifact the highlights describe'
          required: true
          type: string
      steps:
        - name: Prepend highlights to the next draft
          env:
            GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          run: |
            set -euo pipefail
            item=$(jq -c '.items[] | select(.type == "update_next_release")' "$GH_AW_AGENT_OUTPUT" | head -1)
            if [ -z "$item" ]; then
              echo "no update_next_release item in agent output" >&2
              exit 1
            fi
            body=$(jq -r '.body // empty' <<<"$item")
            claimed=$(jq -r '.preview_run // empty' <<<"$item")
            [ -n "$body" ] && [ -n "$claimed" ] || { echo "missing body or preview_run" >&2; exit 1; }

            # Stale-run fence: only write highlights for the LATEST completed
            # preview. A newer preview means its own agent run will summarize
            # the current body — writing now would attach old notes.
            latest=$(gh run list --workflow release-preview --branch main \
              --status completed --limit 1 --json databaseId --jq '.[0].databaseId')
            if [ "$latest" != "$claimed" ]; then
              echo "stale preview run $claimed (latest is $latest) — skipping"
              exit 0
            fi

            gh release view next --json body --jq .body > /tmp/old-body.md
            if grep -q '^## Highlights' /tmp/old-body.md; then
              echo "draft already has a Highlights section — skipping"
              exit 0
            fi
            { printf '%s\n\n' "$body"; cat /tmp/old-body.md; } > /tmp/new-body.md
            gh release edit next --notes-file /tmp/new-body.md
---
