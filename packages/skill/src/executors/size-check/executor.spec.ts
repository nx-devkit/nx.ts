import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sizeCheckExecutor } from './executor.ts'

describe('size-check executor', () => {
  let workspaceRoot: string

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'skill-size-'))
    mkdirSync(join(workspaceRoot, 'skills/my-skill'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'skills/my-skill/SKILL.md'), '# small\n')
  })

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('succeeds on a skill within budget', async () => {
    const res = await sizeCheckExecutor({ path: 'skills/my-skill' }, { root: workspaceRoot })
    expect(res.success).toBe(true)
  })

  it('fails when SKILL.md exceeds 500 lines', async () => {
    writeFileSync(
      join(workspaceRoot, 'skills/my-skill/SKILL.md'),
      Array.from({ length: 501 }, (_, i) => `line ${i}`).join('\n'),
    )
    const res = await sizeCheckExecutor({ path: 'skills/my-skill' }, { root: workspaceRoot })
    expect(res.success).toBe(false)
  })

  it('fails when SKILL.md exceeds 50 KiB', async () => {
    writeFileSync(join(workspaceRoot, 'skills/my-skill/SKILL.md'), 'x'.repeat(51 * 1024))
    const res = await sizeCheckExecutor({ path: 'skills/my-skill' }, { root: workspaceRoot })
    expect(res.success).toBe(false)
  })

  it('fails when SKILL.md is missing', async () => {
    rmSync(join(workspaceRoot, 'skills/my-skill/SKILL.md'))
    const res = await sizeCheckExecutor({ path: 'skills/my-skill' }, { root: workspaceRoot })
    expect(res.success).toBe(false)
  })

  it('ignores node_modules inside the skill dir', async () => {
    mkdirSync(join(workspaceRoot, 'skills/my-skill/node_modules/x'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'skills/my-skill/node_modules/x/big'), 'x'.repeat(2_000_000))
    const res = await sizeCheckExecutor({ path: 'skills/my-skill' }, { root: workspaceRoot })
    expect(res.success).toBe(true)
  })
})
