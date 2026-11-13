---
safe-outputs:
  threat-detection:
    # Detection inherits the main engine+model (anyrouter/auto → currently
    # cohere/north-mini-code), which writes a correct prose verdict but
    # fails to call the threat_detection_result tool — every run ends in
    # no_verdict → warning → safe outputs aborted. Give detection a
    # stronger free smart route; observed resolving to meituan/longcat-2.5.
    model: anyrouter/latest
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
            GH_REPO: ${{ github.repository }}
          run: |
            set -euo pipefail
            # Threat-detection gate: write only on a clean verdict.
            # 'warning' means detection produced no verdict (tooling
            # failure under continue-on-error) — fail closed rather than
            # publish unverified agent output to the release draft.
            case "${GH_AW_DETECTION_CONCLUSION:-}" in
              success|skipped) ;;
              *) echo "threat detection verdict absent/unclean: '${GH_AW_DETECTION_CONCLUSION:-<empty>}' — refusing to write" >&2; exit 1 ;;
            esac
            item=$(jq -c '.items[] | select(.type == "update_next_release")' "$GH_AW_AGENT_OUTPUT" | head -1)
            [ -n "$item" ] || { echo "no update_next_release item in agent output" >&2; exit 1; }
            body=$(jq -r '.body // empty' <<<"$item")
            claimed=$(jq -r '.preview_run // empty' <<<"$item")
            [ -n "$body" ] && [ -n "$claimed" ] || { echo "missing body or preview_run" >&2; exit 1; }

            # Shape validation: only a bounded Highlights section.
            [[ "$body" == "## Highlights"* ]] || { echo "body must start with '## Highlights'" >&2; exit 1; }
            [ "${#body}" -le 8192 ] || { echo "body exceeds 8KB" >&2; exit 1; }

            release=$(gh release view next --json body,isDraft)
            [ "$(jq -r .isDraft <<<"$release")" = "true" ] \
              || { echo "'next' is not a draft — refusing to edit" >&2; exit 1; }
            jq -r .body <<<"$release" > /tmp/old-body.md
            if grep -q '^## Highlights' /tmp/old-body.md; then
              echo "draft already has a Highlights section — skipping"
              exit 0
            fi
            { printf '%s\n\n' "$body"; cat /tmp/old-body.md; } > /tmp/new-body.md

            # Stale-run fence, re-checked immediately before the write:
            # only write highlights for the LATEST SUCCESSFUL preview —
            # a newer one means its own agent run summarizes the current
            # body, and failed/cancelled runs never count.
            latest=$(gh run list --workflow release-preview --branch main \
              --status success --limit 1 --json databaseId --jq '.[0].databaseId')
            if [ "$latest" != "$claimed" ]; then
              echo "stale preview run $claimed (latest is $latest) — skipping"
              exit 0
            fi

            gh release edit next --notes-file /tmp/new-body.md
---
