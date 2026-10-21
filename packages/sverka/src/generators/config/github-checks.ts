/**
 * GitHub-side checks a sverka config can run.
 *
 * These do not look at the code — they verify the state of the repository
 * on GitHub: review debt (GraphQL), the advanced-security surfaces
 * (Dependabot, code scanning, secret scanning) and branch hygiene.
 *
 * Every command uses the `gh` CLI, so it works locally (with `gh auth
 * login`) and in CI (with `GITHUB_TOKEN`).
 */
export interface GithubCheck {
  /** Step id inside the `repo-health` pipeline. */
  id: string
  /** What the check verifies. */
  description: string
  /** Shell command implementing the check. */
  command: string
  /** Secret the check reads, when it needs one. */
  secret?: string
}

/**
 * The `gh` API call that lists open alerts, with a graceful skip.
 *
 * `unavailable` is the message printed when the endpoint cannot be read
 * (the feature is not enabled for the repository, or the token lacks the
 * scope) — the check skips instead of failing.
 */
function alertsCheck(options: {
  endpoint: string
  label: string
  unavailable: string
  /** Shell prefix that exports the token the call should use. */
  token?: string
}): string {
  return [
    ...(options.token ? [options.token] : []),
    `out=$(gh api --paginate 'repos/{owner}/{repo}/${options.endpoint}?state=open' --jq '.[].number' 2>&1)`,
    '|| {',
    `if echo "$out" | grep -qi "not found\\|404\\|403\\|not accessible"; then`,
    `echo "${options.unavailable}"; exit 0; fi;`,
    'echo "$out"; exit 1;',
    '};',
    `[ -z "$out" ] || { echo "open ${options.label}:"; echo "$out"; exit 1; }`,
  ].join(' ')
}

export const GITHUB_CHECKS: Record<string, GithubCheck> = {
  'main-green': {
    id: 'main-green',
    description:
      'Every GitHub Actions check-run on the default branch is green (non-Actions apps are reported, never gated).',
    command: [
      `branch=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name') || exit 1;`,
      `out=$(gh api --paginate "repos/{owner}/{repo}/commits/$branch/check-runs" --jq '.check_runs[] | select(.app.slug == "github-actions") | select(.conclusion != "success" and .conclusion != "skipped" and .conclusion != "neutral") | "\\(.name) (\\(.conclusion // .status))"')`,
      '|| { echo "check-runs query failed"; exit 1; };',
      '[ -z "$out" ] || { echo "non-green checks on $branch:"; echo "$out"; exit 1; };',
      `other=$(gh api --paginate "repos/{owner}/{repo}/commits/$branch/check-runs" --jq '.check_runs[] | select(.app.slug != "github-actions") | "\\(.app.slug): \\(.name) (\\(.conclusion // .status))"')`,
      '|| { echo "check-runs query failed"; exit 1; };',
      '[ -z "$other" ] || { echo "checks from other apps on $branch (reported, never gated):"; echo "$other"; }',
    ].join(' '),
  },

  'review-debt': {
    id: 'review-debt',
    description: 'No unresolved review threads in the last 20 merged PRs (GraphQL).',
    command: [
      `count=$(gh api graphql -f query='query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(first:20,states:MERGED,orderBy:{field:CREATED_AT,direction:DESC}){nodes{reviewThreads(first:100){pageInfo{hasNextPage}nodes{isResolved}}}}}}'`,
      `-F owner='{owner}' -F name='{repo}'`,
      `--jq '([.data.repository.pullRequests.nodes[].reviewThreads.nodes[]|select(.isResolved==false)]|length) + ([.data.repository.pullRequests.nodes[].reviewThreads.pageInfo.hasNextPage|select(.)]|length)')`,
      '|| exit 1;',
      '[ "$count" = "0" ] || { echo "unresolved threads or truncated thread pages: $count"; exit 1; }',
    ].join(' '),
  },

  'dependabot-alerts': {
    id: 'dependabot-alerts',
    description: 'No open Dependabot alerts (advanced security).',
    secret: 'REPO_HEALTH_TOKEN',
    command: [
      '[ -z "$REPO_HEALTH_TOKEN" ] || export GH_TOKEN="$REPO_HEALTH_TOKEN";',
      `out=$(gh api --paginate 'repos/{owner}/{repo}/dependabot/alerts?state=open' --jq '.[].number' 2>&1)`,
      '|| {',
      'if echo "$out" | grep -qi "not accessible\|403"; then',
      // An explicit token that cannot read the alerts is a failure — the
      // check would silently pass otherwise.
      'if [ -n "$REPO_HEALTH_TOKEN" ]; then echo "REPO_HEALTH_TOKEN cannot read dependabot alerts — check its scopes (vulnerability-alerts read) or remove the secret"; exit 1; fi;',
      'echo "::warning::GITHUB_TOKEN cannot read dependabot alerts (needs the vulnerability-alerts permission); check skipped"; exit 0; fi;',
      'echo "$out"; exit 1;',
      '};',
      '[ -z "$out" ] || { echo "open dependabot alerts:"; echo "$out"; exit 1; }',
    ].join(' '),
  },

  'code-scanning': {
    id: 'code-scanning',
    description: 'No open code-scanning alerts (advanced security).',
    command: alertsCheck({
      endpoint: 'code-scanning/alerts',
      label: 'code scanning alerts',
      unavailable: '::warning::code scanning is not available for this repository — check skipped',
    }),
  },

  'secret-scanning': {
    id: 'secret-scanning',
    description: 'No open secret-scanning alerts (advanced security).',
    command: alertsCheck({
      endpoint: 'secret-scanning/alerts',
      label: 'secret scanning alerts',
      unavailable:
        '::warning::secret scanning is not available for this repository — check skipped',
    }),
  },

  'stale-branches': {
    id: 'stale-branches',
    description: 'No remote branch left behind by a merged PR.',
    command: [
      // The status of `git ls-remote` has to be checked before its output
      // is piped — a pipeline reports the status of its last command.
      'remote=$(git ls-remote --heads origin 2>&1) || { echo "ls-remote failed: $remote"; exit 1; };',
      `branches=$(printf '%s\n' "$remote" | sed 's|.*refs/heads/||')`,
      `owner=$(gh repo view --json owner --jq '.owner.login') || exit 1;`,
      `branch=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name') || exit 1;`,
      'stale="";',
      'for b in $branches; do',
      '[ "$b" = "$branch" ] && continue;',
      // `--head` takes the branch name only — the owner prefix is not
      // supported, so forks are filtered out by their owner instead.
      `n=$(gh pr list --head "$b" --state merged --json number,headRepositoryOwner --jq '[.[] | select(.headRepositoryOwner.login == "'"$owner"'")] | length') || exit 1;`,
      '[ "$n" -gt 0 ] && stale="$stale $b";',
      'done;',
      '[ -z "$stale" ] || { echo "stale branches:$stale"; exit 1; }',
    ].join(' '),
  },

  'open-prs': {
    id: 'open-prs',
    description: 'Lists the open PRs (informational, never fails).',
    command: [
      `gh pr list --state open --limit 100 --json number,title,author --jq '.[] | "#\\(.number) \\(.title) (@\\(.author.login))"'`,
      '|| true',
    ].join(' '),
  },
}

/** Ids of the available GitHub checks. */
export const GITHUB_CHECK_IDS = Object.keys(GITHUB_CHECKS)
