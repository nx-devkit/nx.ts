#!/usr/bin/env bun
// Assembles the "next release" preview consumed by release-preview.yml.
//
// Runs AFTER `nx release version --git-push=false` — the version step
// leaves the new versions on disk (committed or not, depending on the
// consumer's nx.json). This script derives the pending release by
// comparing each manifest version against released git tags, generates
// the changelog entries via
// `nx release changelog` (GitHub release creation is patched off by the
// workflow), and emits:
//
//   - tmp/release-preview.md   draft release body
//   - $GITHUB_OUTPUT           title=<one line>, has_release=true|false
//
// has_release=false means "nothing pending" — the workflow deletes the
// draft instead of updating it. Package name → directory is resolved
// through packages/*/package.json because they differ
// (@nx-devkit/typescript lives in packages/typescript-preset).

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

const git = (...args: string[]): string =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
  }).trim();

const nx = (...args: string[]): string =>
  execFileSync('npx', ['nx', ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();

const emit = (fields: Record<string, string>): void => {
  const out = process.env.GITHUB_OUTPUT;
  if (out)
    appendFileSync(
      out,
      `${Object.entries(fields)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')}\n`,
    );
};

// ── nx.json release configuration ──────────────────────────────────────

interface NxJson {
  release?: {
    releaseTag?: { pattern?: string };
    projectsRelationship?: string;
    projects?: string[];
  };
  changelog?: {
    workspaceChangelog?: unknown;
    projectChangelogs?: unknown;
  };
}

// nx.json is JSONC — comments and trailing commas are legal. Fast path
// is plain JSON.parse; on failure strip full-line comments (safe: JSON
// strings cannot span lines), block comments, and trailing commas, then
// retry. A file that still fails to parse fails loud — silently
// assuming defaults would generate the wrong tag scheme.
const parseNxJson = (src: string): NxJson => {
  try {
    return JSON.parse(src) as NxJson;
  } catch {
    const stripped = src
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(stripped) as NxJson;
  }
};

let nxJson: NxJson = {};
try {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- nx.json is a fixed workspace path
  nxJson = parseNxJson(readFileSync(join(root, 'nx.json'), 'utf8'));
} catch (error) {
  if ((error as { code?: string }).code === 'ENOENT') {
    console.error('release-preview: nx.json missing — assuming defaults');
  } else {
    throw error;
  }
}
const fixedRelationship = nxJson.release?.projectsRelationship === 'fixed';
// nx defaults (nx-schema): fixed/unified → `v{version}`, independent →
// `{projectName}@{version}`.
const tagPattern =
  nxJson.release?.releaseTag?.pattern ??
  (fixedRelationship ? 'v{version}' : '{projectName}@{version}');
// A pattern without a project token produces ONE tag for the whole
// release (e.g. `v{version}`) — the workspace-changelog path.
const singleTag = !/\{(projectName|projectNameForPackageRoot)/.test(tagPattern);

// Render the tag pattern for a package@version. Unknown tokens stay
// literal — an unmatched pattern simply yields no pending tag.
const renderTag = (name: string, version: string): string =>
  tagPattern
    .replaceAll('{projectNameForPackageRoot}', name)
    .replaceAll('{projectName}', name)
    .replaceAll('{version}', version);

// Glob matching this package's tag family, for finding the previous
// release tag (`{projectName}@{version}` → `@scope/name@*`,
// `v{version}` → `v*`).
const tagGlob = (name: string): string =>
  tagPattern
    .replaceAll('{projectNameForPackageRoot}', name)
    .replaceAll('{projectName}', name)
    .replaceAll('{version}', '*');

// ── workspace packages ─────────────────────────────────────────────────

interface Pkg {
  name: string;
  version: string;
  dir: string;
  private: boolean;
}

// nx never versions private packages, and release.projects (when set)
// scopes the release to a subset — anything outside it keeps its disk
// version forever and would look permanently "pending".
const releaseProjects = nxJson.release?.projects ?? [];
const inReleaseScope = (pkg: Pkg): boolean => {
  if (pkg.private) return false;
  if (releaseProjects.length === 0) return true;
  return releaseProjects.some(
    (e) =>
      e === pkg.dir || e === pkg.name || e === `packages/${pkg.dir}` || e.endsWith(`/${pkg.dir}`),
  );
};

const packages = new Map<string, Pkg>();
// eslint-disable-next-line security/detect-non-literal-fs-filename -- packagesDir is a fixed workspace path
for (const dir of readdirSync(join(root, 'packages'))) {
  const manifestPath = join(root, 'packages', dir, 'package.json');
  let raw: string;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- manifest path is built from packages/* directory entries
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    continue; // not a package dir
  }
  // Parse outside the try — a malformed manifest must fail loud, not
  // silently drop the package from the preview.
  const pkg = JSON.parse(raw) as {
    name?: string;
    version?: string;
    private?: boolean;
  };
  if (!pkg.name || !pkg.version) continue;
  const entry: Pkg = {
    name: pkg.name,
    version: pkg.version,
    dir,
    private: pkg.private === true,
  };
  if (inReleaseScope(entry)) packages.set(pkg.name, entry);
}

// First `## ` section of a CHANGELOG.md: version + body up to the next one.
const firstSection = (md: string): { version: string; body: string } | null => {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.startsWith('## '));
  if (start === -1) return null;
  const version = lines[start].slice(3).split(' ')[0];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  let b = start + 1;
  while (b < end && lines[b].trim() === '') b++;
  return { version, body: lines.slice(b, end).join('\n').trim() };
};

// nx writes this boilerplate for alignment bumps — no user-facing changes.
const isBumpOnly = (body: string): boolean =>
  /version bump only/.test(body) && /no code changes/.test(body);

interface Pending {
  name: string;
  version: string;
  tag: string;
  from: string | null;
  body: string;
  bumpOnly: boolean;
}

// A package is pending when the version `nx release version` just wrote
// to its manifest is not yet a released tag. Released-ness is checked
// against remote tags — this works whether the consumer's nx.json
// creates git tags during `version` (version.git.tag) or during
// `changelog` (changelog.git.tag, the nx 23 default): in the latter
// case no new tag exists at all yet, and in the former the new tag is
// local-only so it is not on the remote either.
let remoteTags = new Set<string>();
let remoteOk = false;
try {
  remoteTags = new Set(
    git('ls-remote', '--tags', 'origin')
      .split('\n')
      .map(
        (l) =>
          l
            .trim()
            .split('refs/tags/')[1]
            ?.replace(/\^\{\}$/, '') ?? '',
      )
      .filter(Boolean),
  );
  remoteOk = true;
} catch (error) {
  console.error(
    `release-preview: ls-remote failed (${String(error)}) — falling back to local tags`,
  );
}
// Fail-open fallback when ls-remote is unavailable: a local tag counts
// as released unless it sits at HEAD — tags nx just created during
// `version` point at the release commit and must stay pending.
const headTags = new Set(git('tag', '--points-at', 'HEAD').split('\n').filter(Boolean));
const localTags = new Set(git('tag', '--list').split('\n').filter(Boolean));
const isReleased = (tag: string): boolean =>
  remoteOk ? remoteTags.has(tag) : localTags.has(tag) && !headTags.has(tag);

const pending: Pending[] = [];
const seenTags = new Set<string>();
for (const pkg of packages.values()) {
  const tag = renderTag(pkg.name, pkg.version);
  if (isReleased(tag)) continue; // disk version already published
  if (seenTags.has(tag)) continue; // fixed lockstep: many packages → one tag
  seenTags.add(tag);

  // Previous release tag in this package's tag family.
  const family = git('tag', '--list', tagGlob(pkg.name), '--sort=-version:refname')
    .split('\n')
    .filter(Boolean);
  const prevTag = family.find(isReleased);

  pending.push({
    name: pkg.name,
    version: pkg.version,
    tag,
    from: prevTag ?? null,
    body: '',
    bumpOnly: false,
  });
}

if (pending.length === 0) {
  emit({ has_release: 'false' });
  console.log('release-preview: no pending release — draft should be deleted');
  process.exit(0);
}

// ── changelog generation ───────────────────────────────────────────────
// The workflow's old per-tag shell loop is replaced by this: the same
// pattern logic that matched the tags now drives `nx release changelog`.
// createRelease is already patched to false in nx.json by the workflow,
// so nothing reaches GitHub.

const runChangelog = (
  version: string,
  project: string | null,
  from: string | null,
  firstRelease: boolean,
): void => {
  const args = ['release', 'changelog', version];
  if (project) args.push('-p', project);
  if (from) args.push('--from', from);
  else if (firstRelease) args.push('--first-release');
  // Neither flag: nx derives the commit range itself (fixed groups).
  args.push('--git-commit=false', '--git-tag=false', '--git-push=false');
  nx(...args);
};

if (singleTag || fixedRelationship) {
  // One release for the whole workspace — nx resolves the fixed group
  // itself; --from is omitted so nx derives the range like the repo's
  // own release pipeline does. --first-release still applies when the
  // family has no released tag at all.
  const p = pending[0];
  runChangelog(p.version, null, null, !p.from);
  // Pick the changelog path from nx.json's changelog config: a fixed
  // relationship does not imply a workspace changelog. Workspace first
  // when configured (or when nothing is — nx's default); per-project
  // aggregate first when only projectChangelogs is set. The other path
  // stays as fallback so mixed configs still produce content.
  const hasWorkspaceChangelog = nxJson.changelog?.workspaceChangelog != null;
  const hasProjectChangelogs = nxJson.changelog?.projectChangelogs != null;
  const workspaceFirst = hasWorkspaceChangelog || !hasProjectChangelogs;

  const fromWorkspace = (): string | null => {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed workspace path
      const section = firstSection(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'));
      if (section && section.version === p.version) return section.body;
      if (section)
        console.error(
          `release-preview: workspace CHANGELOG top is ${section.version}, expected ${p.version}`,
        );
    } catch {
      // no workspace CHANGELOG.md
    }
    return null;
  };

  const fromProjects = (): string | null => {
    const parts: string[] = [];
    for (const pkg of packages.values()) {
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- path built from packages/* directory entries
        const s = firstSection(
          readFileSync(join(root, 'packages', pkg.dir, 'CHANGELOG.md'), 'utf8'),
        );
        if (s && s.version === p.version) parts.push(`#### \`${pkg.name}\`\n\n${s.body}`);
      } catch {
        // no per-package changelog for this project
      }
    }
    return parts.length > 0 ? parts.join('\n\n') : null;
  };

  p.body =
    (workspaceFirst ? (fromWorkspace() ?? fromProjects()) : (fromProjects() ?? fromWorkspace())) ??
    '';
  if (!p.body)
    console.error(`release-preview: no changelog section for ${p.version} — placeholder body kept`);
} else {
  for (const p of pending) {
    runChangelog(p.version, p.name, p.from, !p.from);
  }
}

// Per-project changelog bodies (independent mode).
if (!singleTag && !fixedRelationship) {
  for (const p of pending) {
    const pkg = packages.get(p.name);
    if (!pkg) continue;
    const changelogPath = join(root, 'packages', pkg.dir, 'CHANGELOG.md');
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is built from packages/* directory entries
      const section = firstSection(readFileSync(changelogPath, 'utf8'));
      if (section && section.version === p.version) {
        p.body = section.body;
      } else if (section) {
        console.error(
          `release-preview: ${p.name} CHANGELOG top is ${section.version}, expected ${p.version} — placeholder body kept`,
        );
      }
    } catch {
      // missing CHANGELOG.md — keep the placeholder body
    }
    p.bumpOnly = isBumpOnly(p.body);
  }
}

const changed = pending.filter((p) => !p.bumpOnly);
const bumps = pending.filter((p) => p.bumpOnly);

const title =
  singleTag || fixedRelationship
    ? `Next release — ${pending[0].version}`
    : changed.length > 0
      ? `Next release — ${changed
          .slice(0, 3)
          .map((p) => `${p.name}@${p.version}`)
          .join(', ')}${changed.length > 3 ? ` +${changed.length - 3} more` : ''}`
      : `Next release — ${pending.length} package${pending.length === 1 ? '' : 's'}, version bumps only`;

const remote = git('remote', 'get-url', 'origin');
const repoMatch = remote.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
const repoUrl = repoMatch ? `https://github.com/${repoMatch[1]}/${repoMatch[2]}` : remote;
// When the version step committed (version.git.commit), HEAD is the
// local chore(release) commit and HEAD~1 is the pushed main commit the
// preview describes. Consumers with git.commit=false leave HEAD on the
// branch tip — link HEAD itself then.
let base = 'HEAD';
try {
  if (git('log', '-1', '--format=%s').startsWith('chore(release)')) {
    base = git('rev-parse', 'HEAD~1');
  }
} catch {
  // single-commit checkout — keep HEAD
}

// Inverse of renderTag: extract the version a tag carries, for display.
// `{projectName}@{version}` + `@scope/name@1.2.3` → `1.2.3`,
// `v{version}` + `v1.2.3` → `1.2.3`.
const versionOf = (tag: string, name: string): string => {
  const [pre, post = ''] = tagPattern.split('{version}');
  const fill = (s: string): string =>
    s.replaceAll('{projectNameForPackageRoot}', name).replaceAll('{projectName}', name);
  const prefix = fill(pre);
  const suffix = fill(post);
  if (tag.startsWith(prefix) && tag.endsWith(suffix) && tag.length >= prefix.length + suffix.length)
    return tag.slice(prefix.length, tag.length - suffix.length);
  return tag;
};

const range = (p: Pending): string =>
  `\`${p.name}\` — ${p.from ? versionOf(p.from, p.name) : 'new'} → ${p.version}`;

const sections: string[] = [
  `**Next release preview** — what \`nx release\` will publish for the commits on \`main\`.`,
  `Regenerated on every push to \`main\` and removed when nothing is pending.`,
  `**Publishing this draft ships the release** — publishing it is the release decision.`,
  ``,
  `Base: [\`${base.slice(0, 7)}\`](${repoUrl}/commit/${base}) · generated ${new Date().toISOString()}`,
];

if (singleTag || fixedRelationship) {
  const p = pending[0];
  // Member packages are listed separately from the changelog body so a
  // missing changelog still surfaces the placeholder notice.
  const members = [...packages.values()].map((m) => m.name).sort();
  const details = `<details><summary>Packages in this release (${members.length})</summary>\n\n${members.map((m) => `- \`${m}\``).join('\n')}\n\n</details>`;
  sections.push(
    '',
    `### Release ${p.version}`,
    '',
    p.body || '_Changelog entry missing — see the release-preview workflow log._',
    '',
    details,
    '',
  );
} else {
  if (changed.length > 0) {
    sections.push('', `### Packages with changes (${changed.length})`, '');
    for (const p of changed) {
      sections.push(`#### ${range(p)}`, '', p.body, '');
    }
  }

  if (bumps.length > 0) {
    sections.push(`### Version-only bumps (${bumps.length})`, '');
    for (const p of bumps) {
      sections.push(`- ${range(p)} — no code changes`);
    }
    sections.push('');
  }
}

const bodyPath = join(root, 'tmp', 'release-preview.md');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed tmp path under the workspace root
mkdirSync(join(root, 'tmp'), { recursive: true });
// eslint-disable-next-line security/detect-non-literal-fs-filename -- same fixed workspace path
writeFileSync(bodyPath, `${sections.join('\n').trimEnd()}\n`);

emit({
  title: title.replace(/\s*\n\s*/g, ' '),
  has_release: 'true',
  changed: String(changed.length),
  bumps: String(bumps.length),
  // The pushed main commit this preview describes — the draft pins its
  // target to it so publishing releases exactly what was previewed, even
  // if main moved since.
  base,
});
console.log(`release-preview: ${pending.length} package(s), ${changed.length} with changes`);
