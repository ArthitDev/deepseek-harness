import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-skill'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

async function writeSkill(root: string, name: string): Promise<void> {
  const bundle = join(root, name)
  await mkdir(bundle, { recursive: true })
  await writeFile(join(bundle, 'SKILL.md'), `---
name: ${name}
description: Must not enter the Web replay scaffold
---

Ambient host state.
`)
}

it('isolates replay skill discovery from host roots and ancestor repositories while keeping workspace skills', async () => {
  const ambient = await mkdtemp(join(tmpdir(), 'dsh-web-ambient-skills-'))
  const dshHome = join(ambient, 'dsh-home')
  const agentsHome = join(ambient, 'agents-home')
  const bundled = join(ambient, 'bundled')
  await Promise.all([
    mkdir(join(ambient, '.git')),
    writeFile(join(ambient, 'AGENTS.md'), 'Ambient ancestor instructions must not enter replay.\n'),
    writeSkill(join(ambient, '.agents', 'skills'), 'ambient-ancestor'),
    writeSkill(join(dshHome, 'skills'), 'ambient-dsh'),
    writeSkill(join(agentsHome, 'skills'), 'ambient-agents'),
    writeSkill(bundled, 'ambient-bundled'),
  ])

  const originalDshHome = process.env.DSH_HOME
  const originalAgentsHome = process.env.DSH_AGENTS_HOME
  const originalBundled = process.env.DSH_BUNDLED_SKILL_DIR
  const originalTemp = Object.fromEntries(['TMPDIR', 'TEMP', 'TMP'].map(key => [key, process.env[key]]))
  Object.assign(process.env, { TMPDIR: ambient, TEMP: ambient, TMP: ambient })
  process.env.DSH_HOME = dshHome
  process.env.DSH_AGENTS_HOME = agentsHome
  process.env.DSH_BUNDLED_SKILL_DIR = bundled
  let scaffold: WebScaffold | undefined
  try {
    scaffold = await launchWebScaffold()
    const ctx = scaffold.ctx
    await writeSkill(join(scaffold.workspaceCwd, '.agents', 'skills'), 'workspace-owned')
    // Local skill discovery belongs to the agent's preset LAYER of the host
    // registry, so the roots under test are only reachable through a composed
    // agent's view — the same scope the `skills/list` Remote resolves for a
    // browser request about a session.
    const handle = await ctx.agents.create({
      sessionId: SessionId('hermetic-skills'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
    try {
      const skills = ctx.get('skills')
      if (skills === undefined) throw new Error('the composition mounts no skill registry')
      const catalog = await skills.list({ cwd: scaffold.workspaceCwd, scope: handle.agent })
      const names = catalog.map(skill => skill.name)
      expect(names).not.toContain('ambient-dsh')
      expect(names).not.toContain('ambient-agents')
      expect(names).not.toContain('ambient-bundled')
      expect(names).not.toContain('ambient-ancestor')
      expect(names).toContain('workspace-owned')
      const aclDiagnosis = await skills.get('diagnose-windows-sandbox-acl', { scope: handle.agent })
      if (process.platform === 'win32') {
        expect(aclDiagnosis?.invocation).toEqual({ modelInvocable: false, userInvocable: true })
        expect(aclDiagnosis?.content).toContain('Windows')
        expect(catalog.filter(skill => skill.invocation.modelInvocable).map(skill => skill.name))
          .not.toContain('diagnose-windows-sandbox-acl')
      } else {
        expect(aclDiagnosis).toBeUndefined()
      }
    } finally {
      await handle.dispose()
    }
  } finally {
    try {
      await scaffold?.close()
    } finally {
      if (originalDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = originalDshHome
      if (originalAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME
      else process.env.DSH_AGENTS_HOME = originalAgentsHome
      if (originalBundled === undefined) delete process.env.DSH_BUNDLED_SKILL_DIR
      else process.env.DSH_BUNDLED_SKILL_DIR = originalBundled
      for (const [key, value] of Object.entries(originalTemp)) {
        if (value === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = value
      }
      await rm(ambient, { recursive: true, force: true })
    }
  }
})
