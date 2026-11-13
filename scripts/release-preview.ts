#!/usr/bin/env bun
// Assembles the "next release" preview consumed by release-preview.yml.
//
// Runs AFTER `nx release version --git-push=false` and the per-tag
// `nx release changelog` loop — the version step leaves one local
// `chore(release)` commit carrying every new `@scope/name@x.y.z` tag, and
// the changelog step prepends the pending entry to each
// packages/*/CHANGELOG.md. This script reads that state and emits:
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

// name@x.y.z — scoped (`@scope/name@x.y.z`) or unscoped (`pkg@x.y.z`);
// version must start with a digit so tags like `pkg@bar` cannot slip
// through. The `v{version}` fixed-tag scheme is not this format.
const parseTag = (tag: string): { name: string; version: string } | null => {
  const at = tag.lastIndexOf('@');
  if (at <= 0) return null;
  const name = tag.slice(0, at);
  const version = tag.slice(at + 1);
  if (!name || !/^\d+\.\d+\.\d+/.test(version)) return null;
  return { name, version };
};

const packageDirByName = new Map<string, string>();
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
  const pkg = JSON.parse(raw) as { name?: string };
  if (pkg.name) packageDirByName.set(pkg.name, dir);
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
  from: string | null;
  body: string;
  bumpOnly: boolean;
}

// Tags already on the remote are published, not pending — e.g. a release
// run that pushed version+tags and then failed before the changelog
// commit leaves them on HEAD. ls-remote needs no auth on public repos;
// on failure warn and keep everything (fail-open: a stale draft
// self-corrects on the next run).
let remoteTags = new Set<string>();
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
} catch (error) {
  console.error(
    `release-preview: ls-remote failed (${String(error)}) — remote tag filter disabled`,
  );
}

const pending: Pending[] = [];
for (const tag of git('tag', '--points-at', 'HEAD').split('\n').filter(Boolean)) {
  const parsed = parseTag(tag);
  if (!parsed || remoteTags.has(tag)) continue;
  const dir = packageDirByName.get(parsed.name);
  if (!dir) {
    console.error(`release-preview: no packages/*/package.json named ${parsed.name} — skipped`);
    continue;
  }
  const tags = git('tag', '--list', `${parsed.name}@*`, '--sort=-version:refname')
    .split('\n')
    .filter(Boolean);
  const idx = tags.indexOf(tag);
  const prev = idx >= 0 ? tags[idx + 1] : undefined;
  const changelogPath = join(root, 'packages', dir, 'CHANGELOG.md');
  let body = '_Changelog entry missing — see the release-preview workflow log._';
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is built from packages/* directory entries
    const section = firstSection(readFileSync(changelogPath, 'utf8'));
    if (section && section.version === parsed.version) {
      body = section.body;
    } else if (section) {
      console.error(
        `release-preview: ${parsed.name} CHANGELOG top is ${section.version}, expected ${parsed.version} — placeholder body kept`,
      );
    }
  } catch {
    // missing CHANGELOG.md — keep the placeholder body
  }
  pending.push({
    name: parsed.name,
    version: parsed.version,
    from: prev ? prev.slice(prev.lastIndexOf('@') + 1) : null,
    body,
    bumpOnly: isBumpOnly(body),
  });
}

if (pending.length === 0) {
  emit({ has_release: 'false' });
  console.log('release-preview: no pending release — draft should be deleted');
  process.exit(0);
}

const changed = pending.filter((p) => !p.bumpOnly);
const bumps = pending.filter((p) => p.bumpOnly);

const title =
  changed.length > 0
    ? `Next release — ${changed
        .slice(0, 3)
        .map((p) => `${p.name}@${p.version}`)
        .join(', ')}${changed.length > 3 ? ` +${changed.length - 3} more` : ''}`
    : `Next release — ${pending.length} package${pending.length === 1 ? '' : 's'}, version bumps only`;

const remote = git('remote', 'get-url', 'origin');
const repoMatch = remote.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
const repoUrl = repoMatch ? `https://github.com/${repoMatch[1]}/${repoMatch[2]}` : remote;
// HEAD is the local chore(release) commit — HEAD~1 is the pushed main
// commit the preview describes. Fall back to HEAD if the history is odd.
let base = 'HEAD';
try {
  base = git('rev-parse', 'HEAD~1');
} catch {
  // single-commit checkout — link HEAD instead
}

const range = (p: Pending): string => `\`${p.name}\` — ${p.from ?? 'new'} → ${p.version}`;

const sections: string[] = [
  `**Next release preview** — what \`nx release\` will publish for the commits on \`main\`.`,
  `Regenerated on every push to \`main\` and removed when nothing is pending.`,
  `**Publishing this draft ships the release** — publishing it is the release decision.`,
  ``,
  `Base: [\`${base.slice(0, 7)}\`](${repoUrl}/commit/${base}) · generated ${new Date().toISOString()}`,
];

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
