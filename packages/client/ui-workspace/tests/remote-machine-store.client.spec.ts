// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { RemoteMachineView } from '@deepseek-ai/dsh-remote-machines/types'
import { RemoteMachineController } from '../src/client/remote-machine-store.ts'

const machine = (id: string, name = id): RemoteMachineView => ({
  id, name, host: '192.0.2.10', port: 22, username: 'tester', auth: 'agent',
  hasPassword: false, hasPrivateKey: false, hasPassphrase: false,
})

type ListResult = Promise<
  | { ok: true; value: { machines: readonly RemoteMachineView[] } }
  | { ok: false; error: { code: string; message: string } }
>

interface NamespaceDouble {
  list: () => ListResult
  save: () => Promise<{ ok: true; value: { machine: RemoteMachineView } }>
  deleteMachine: (request: { id: string }) => Promise<{ ok: true; value: { removed: true } } | { ok: false; error: { message: string } }>
  probe: () => Promise<{ ok: true; value: { fingerprint: string; trusted: boolean; platform: string } }>
  trust: () => Promise<{ ok: true; value: { machine: RemoteMachineView } }>
}

function bench(list: () => ListResult): { ctx: Context; namespace: NamespaceDouble } {
  const ctx = new Context()
  const namespace: NamespaceDouble = {
    list,
    save: vi.fn(async () => ({ ok: true as const, value: { machine: machine('saved') } })),
    deleteMachine: vi.fn(async () => ({ ok: true as const, value: { removed: true as const } })),
    probe: vi.fn(async () => ({ ok: true as const, value: { fingerprint: 'sha256:probe', trusted: false, platform: 'linux' } })),
    trust: vi.fn(async () => ({ ok: true as const, value: { machine: { ...machine('lab'), fingerprint: 'sha256:probe' } } })),
  }
  ctx.provide('remote', { remoteMachines: namespace } as never)
  return { ctx, namespace }
}

describe('RemoteMachineController', () => {
  it('loads the roster into the shared snapshot', async () => {
    const { ctx } = bench(async () => ({ ok: true as const, value: { machines: [machine('lab', 'Kali Lab')] } }))
    const controller = new RemoteMachineController(ctx)
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready', error: null, machines: [expect.objectContaining({ id: 'lab', name: 'Kali Lab' })],
    })
    await ctx.fiber.dispose()
  })

  it('treats an absent Host service as an empty ready roster', async () => {
    const { ctx } = bench(async () => ({
      ok: false as const, error: { code: 'gateway/invocation-unavailable', message: 'no service' },
    }))
    const controller = new RemoteMachineController(ctx)
    await controller.load()
    expect(controller.store.getSnapshot()).toEqual({ status: 'ready', machines: [], error: null })
    await ctx.fiber.dispose()
  })

  it('surfaces roster failures without losing the error', async () => {
    const { ctx } = bench(async () => ({
      ok: false as const, error: { code: 'remote-machine/invalid', message: 'boom' },
    }))
    const controller = new RemoteMachineController(ctx)
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'boom' })
    await ctx.fiber.dispose()
  })

  it('removes the machine from the local snapshot after a Host deleteMachine', async () => {
    const { ctx } = bench(async () => ({ ok: true as const, value: { machines: [machine('lab')] } }))
    const controller = new RemoteMachineController(ctx)
    await controller.load()
    await controller.remove('lab')
    expect(controller.store.getSnapshot().machines).toEqual([])
    await ctx.fiber.dispose()
  })

  it('keeps the machine when the Host refuses the deletion', async () => {
    const { ctx, namespace } = bench(async () => ({ ok: true as const, value: { machines: [machine('lab')] } }))
    namespace.deleteMachine = async () => ({ ok: false, error: { message: 'in use' } })
    const controller = new RemoteMachineController(ctx)
    await controller.load()
    await expect(controller.remove('lab')).rejects.toThrow('in use')
    expect(controller.store.getSnapshot().machines).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('marks a trusted machine through the probe-then-trust flow', async () => {
    const { ctx } = bench(async () => ({ ok: true as const, value: { machines: [machine('lab')] } }))
    const controller = new RemoteMachineController(ctx)
    await controller.load()
    const observed = await controller.probe('lab')
    expect(observed).toMatchObject({ fingerprint: 'sha256:probe', trusted: false })
    await controller.trust('lab', observed.fingerprint)
    expect(controller.store.getSnapshot().machines[0]).toMatchObject({ id: 'lab', fingerprint: 'sha256:probe' })
    await ctx.fiber.dispose()
  })
})
