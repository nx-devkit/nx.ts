import { describe, expect, it } from 'vitest'
import { renderChangelog } from './changelog.ts'

describe('renderChangelog', () => {
  it('renders the heading, the groups and the bullets', () => {
    const changelog = renderChangelog({
      version: '0.0.19',
      date: '2026-10-22',
      changes: [
        {
          type: 'feat',
          scope: 'diagrams',
          breaking: false,
          description: 'serverless Kroki with the companion services',
          pullRequest: { number: 130, url: 'https://github.com/nx-devkit/nx.ts/pull/130' },
        },
        {
          type: 'fix',
          scope: undefined,
          breaking: false,
          description: 'declare jsonc-parser',
        },
      ],
    })

    expect(changelog).toContain('## 0.0.19 (2026-10-22)')
    expect(changelog).toContain('### 🚀 Features')
    expect(changelog).toContain(
      '- **diagrams:** serverless Kroki with the companion services ([#130](https://github.com/nx-devkit/nx.ts/pull/130))',
    )
    expect(changelog).toContain('### 🩹 Fixes')
    expect(changelog).toContain('- declare jsonc-parser')
  })

  it('groups the changes that fit no other heading', () => {
    const changelog = renderChangelog({
      version: '1.0.0',
      date: '2026-10-22',
      changes: [{ type: 'refactor', scope: undefined, breaking: false, description: 'tidy up' }],
    })

    expect(changelog).toContain('### 📦 Other')
  })

  it('marks a breaking change', () => {
    const changelog = renderChangelog({
      version: '2.0.0',
      date: '2026-10-22',
      changes: [
        {
          type: 'feat',
          scope: 'release',
          breaking: true,
          description: 'drop the old option',
        },
      ],
    })

    expect(changelog).toContain('- **⚠ BREAKING CHANGE:** **release:** drop the old option')
  })

  it('drops a pull request link that is not a safe https URL', () => {
    const changelog = renderChangelog({
      version: '1.0.0',
      date: '2026-10-22',
      changes: [
        {
          type: 'fix',
          scope: undefined,
          breaking: false,
          description: 'a fix',
          pullRequest: { number: 7, url: 'javascript:alert(1)' },
        },
      ],
    })

    expect(changelog).not.toContain('javascript:')
    expect(changelog).toContain('- a fix')
  })

  it('lists the contributors', () => {
    const changelog = renderChangelog({
      version: '1.0.0',
      date: '2026-10-22',
      changes: [],
      authors: [{ name: 'Petr Plenkov', handle: 'ThePlenkov' }],
    })

    expect(changelog).toContain('### ❤️ Thank You')
    expect(changelog).toContain('- Petr Plenkov @ThePlenkov')
  })
})
