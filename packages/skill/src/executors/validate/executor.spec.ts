import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateExecutor } from './executor.ts'

const VALID_SKILL = `---
name: my-skill
description: does things
---

# My Skill
`

describe('validate executor', () => {
  let workspaceRoot: string

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'skill-validate-'))
    mkdirSync(join(workspaceRoot, 'skills/my-skill'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'skills/my-skill/SKILL.md'), VALID_SKILL)
  })

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('succeeds on a valid skill', async () => {
    const res = await validateExecutor({ path: 'skills/my-skill' }, { root: workspaceRoot })
    expect(res.success).toBe(true)
  })

  it('fails when SKILL.md is missing', async () => {
    rmSync(join(workspaceRoot, 'skills/my-skill/SKILL.md'))
    const res = await validateExecutor({ path: 'skills/my-skill' }, { root: workspaceRoot })
    expect(res.success).toBe(false)
  })

  it('fails on missing frontmatter', async () => {
    writeFileSync(join(workspaceRoot, 'skills/my-skill/SKILL.md'), '# no frontmatter\n')
    const res = await validateExecutor({ path: 'skills/my-skill' }, { root: workspaceRoot })
    expect(res.success).toBe(false)
  })

  it('fails when name does not match directory', async () => {
    writeFileSync(
      join(workspaceRoot, 'skills/my-skill/SKILL.md'),
      '---\nname: other-name\ndescription: x\n---\n',
    )
    const res = await validateExecutor({ path: 'skills/my-skill' }, { root: workspaceRoot })
    expect(res.success).toBe(false)
  })

  it('fails on non-kebab-case name', async () => {
    writeFileSync(
      join(workspaceRoot, 'skills/my-skill/SKILL.md'),
      '---\nname: My_Skill\ndescription: x\n---\n',
    )
    const res = await validateExecutor({ path: 'skills/my-skill' }, { root: workspaceRoot })
    expect(res.success).toBe(false)
  })

  it('fails when agents/openai.yaml is malformed', async () => {
    mkdirSync(join(workspaceRoot, 'skills/my-skill/agents'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'skills/my-skill/agents/openai.yaml'), 'display_name: x\n')
    const res = await validateExecutor({ path: 'skills/my-skill' }, { root: workspaceRoot })
    expect(res.success).toBe(false)
  })

  it('passes when agents/openai.yaml has required fields', async () => {
    mkdirSync(join(workspaceRoot, 'skills/my-skill/agents'), { recursive: true })
    writeFileSync(
      join(workspaceRoot, 'skills/my-skill/agents/openai.yaml'),
      'display_name: My Skill\nshort_description: does things\ndefault_prompt: run it\n',
    )
    const res = await validateExecutor({ path: 'skills/my-skill' }, { root: workspaceRoot })
    expect(res.success).toBe(true)
  })
})
