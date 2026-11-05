import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import RemoteMachines from '../src/index.ts'
import { remoteExecutionPath } from '../src/path.ts'

const contexts: Context[] = []

class TestWorkspaceRegistry extends Service {
  constructor(ctx: Context) { super(ctx, 'workspaceRegistry') }
  list() { return [{ path: remoteExecutionPath('machine-test', '/srv/project') }] }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => { await ctx.fiber.dispose() }))
})

describe('remote machine settings', () => {
  it('redacts saved secrets and removes credentials from the previous auth mode', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('settings', {
      update: async (_ns: string, patch: Record<string, unknown>) => { await live.update(patch) },
    } as never)
    await ctx.plugin(TestWorkspaceRegistry).await()
    const live = await liveConfig(ctx, RemoteMachines)
    const machines = ctx.remoteMachines
    const base = {
      id: 'machine-test', name: 'Test', host: 'ssh.test', port: 22, username: 'tester',
    }

    await machines.save({
      ...base, auth: 'private-key', privateKey: 'fixture-private-key', passphrase: 'fixture-passphrase',
    })
    expect(machines.list()).toEqual({ machines: [expect.objectContaining({
      id: 'machine-test', hasPrivateKey: true, hasPassphrase: true,
    })] })
    expect(JSON.stringify(machines.list())).not.toContain('fixture-private-key')

    await machines.save({ ...base, auth: 'private-key' })
    expect(machines.profile('machine-test')).toMatchObject({
      privateKey: 'fixture-private-key', passphrase: 'fixture-passphrase',
    })

    await machines.save({ ...base, auth: 'agent' })
    expect(machines.profile('machine-test')).not.toHaveProperty('privateKey')
    expect(machines.profile('machine-test')).not.toHaveProperty('passphrase')

    await machines.save({ ...base, auth: 'password-prompt', password: 'fixture-session-password' })
    expect(machines.profile('machine-test')).not.toHaveProperty('password')
    expect(JSON.stringify(machines.list())).not.toContain('fixture-session-password')
    await expect(machines.remove({ id: 'machine-test' })).rejects.toMatchObject({ code: 'remote-machine/in-use' })
    expect(machines.profile('machine-test')).toBeDefined()
  })
})
