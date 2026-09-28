import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { osCheckExecutor } from './executor.ts'

describe('os-check executor', () => {
  let workspaceRoot: string

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'skill-oscheck-'))
    mkdirSync(join(workspaceRoot, 'skills/my-skill'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'skills/my-skill/SKILL.md'), '# portable\nuse curl\n')
  })

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('succeeds on a portable skill', async () => {
    const res = await osCheckExecutor({ path: 'skills/my-skill' }, { root: workspaceRoot })
    expect(res.success).toBe(true)
  })

  it('fails on a hardcoded user path', async () => {
    writeFileSync(join(workspaceRoot, 'skills/my-skill/SKILL.md'), 'edit /Users/alice/x\n')
    const res = await osCheckExecutor({ path: 'skills/my-skill' }, { root: workspaceRoot })
    expect(res.success).toBe(false)
  })

  it('fails on OS-only command without alternative', async () => {
    writeFileSync(join(workspaceRoot, 'skills/my-skill/SKILL.md'), 'run brew install fzf\n')
    const res = await osCheckExecutor({ path: 'skills/my-skill' }, { root: workspaceRoot })
    expect(res.success).toBe(false)
  })

  it('passes when an OS-only command documents an alternative', async () => {
    writeFileSync(
      join(workspaceRoot, 'skills/my-skill/SKILL.md'),
      'brew install fzf (or apt-get install fzf)\n',
    )
    const res = await osCheckExecutor({ path: 'skills/my-skill' }, { root: workspaceRoot })
    expect(res.success).toBe(true)
  })

  it('fails when the skill directory does not exist', async () => {
    const res = await osCheckExecutor({ path: 'skills/gone' }, { root: workspaceRoot })
    expect(res.success).toBe(false)
  })
})
