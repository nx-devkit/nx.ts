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
            BRANCH: ${{ inputs.branch || 'main' }}
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
            # only write highlights for the LATEST trusted preview — a
            # newer trusted artifact means a newer preview superseded this
            # body, and its own agent run summarizes the current body
            # instead. "Trusted" mirrors fetch_preview: this run, or a
            # completed+successful run on this repo's release branch —
            # failed/cancelled producers and foreign uploads (fork/PR runs
            # can publish same-named artifacts) neither count as latest nor
            # can mask staleness. Artifact-name-keyed, not workflow-name-
            # keyed, so reusable callers work.
            CANDIDATES=$(gh api "repos/$GH_REPO/actions/artifacts?name=release-preview-body&per_page=100" \
              --jq '[.artifacts[] | select(.expired == false)] | sort_by(.created_at) | reverse | .[].workflow_run.id')
            latest=""
            while IFS= read -r candidate; do
              [ -n "$candidate" ] || continue
              if [ "$candidate" = "$GITHUB_RUN_ID" ]; then
                latest="$candidate"
                break
              fi
              run_json=$(gh api "repos/$GH_REPO/actions/runs/$candidate")
              if [ "$(jq -r '.status' <<<"$run_json")" = "completed" ] \
                && [ "$(jq -r '.conclusion // ""' <<<"$run_json")" = "success" ] \
                && [ "$(jq -r '.head_branch' <<<"$run_json")" = "$BRANCH" ] \
                && [ "$(jq -r '.head_repository.full_name' <<<"$run_json")" = "$GH_REPO" ]; then
                latest="$candidate"
                break
              fi
            done <<< "$CANDIDATES"
            if [ "$latest" != "$claimed" ]; then
              echo "stale preview run $claimed (latest trusted artifact run is ${latest:-none}) — skipping"
              exit 0
            fi

            # In-progress race: a NEWER preview may have started after the
            # agent read its body but before this write — its artifact does
            # not exist yet, so the scan above cannot see it. If a trusted
            # producer run newer than the claimed one is still active, this
            # body is already superseded; writing would pin stale highlights
            # (the duplicate-Highlights guard then blocks the correction).
            claimed_created=$(gh api "repos/$GH_REPO/actions/runs/$claimed" --jq '.created_at')
            # The producer workflow: native previews run release-preview.yml;
            # reusable callers produce the artifact inside their own caller
            # workflow — the github context here IS the caller's, so
            # GITHUB_WORKFLOW_REF names it (release-ai-notes* means native).
            wf_file="${GITHUB_WORKFLOW_REF#*.github/workflows/}"
            wf_file="${wf_file%@*}"
            if [[ "$wf_file" == *release-ai-notes* ]]; then
              producer="release-preview.yml"
            else
              producer="$wf_file"
            fi
            superseded=$(gh api "repos/$GH_REPO/actions/workflows/$producer/runs?branch=$BRANCH&per_page=20" \
              --jq --arg self "$GITHUB_RUN_ID" --arg since "$claimed_created" --arg repo "$GH_REPO" \
              '[.workflow_runs[] | select(.id != ($self | tonumber)) | select(.status != "completed") | select(.created_at > $since) | select(.head_repository.full_name == $repo)] | length')
            if [ "$superseded" != "0" ]; then
              echo "newer $producer run in progress — claimed preview $claimed is superseded, skipping"
              exit 0
            fi

            gh release edit next --notes-file /tmp/new-body.md
---
