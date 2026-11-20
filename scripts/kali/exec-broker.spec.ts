import { createServer, request, type Server } from 'node:http'
import type { Socket } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBroker, validateContainer } from './exec-broker.mjs'

const firstId = 'a'.repeat(64)
const secondId = 'b'.repeat(64)
const name = 'dsh-vpn-kali'
const binds: [string, string, boolean][] = [
  ['/home/epit-agent/stacks/harness-vpn/state/kali-root', '/root', true],
  ['/home/epit-agent/projects/deepseek-harness', '/workspace', true],
  ['/etc/netns/dsh-vpn/resolv.conf', '/etc/resolv.conf', false],
  ['/home/epit-agent/.dsh/cyber-wiki', '/home/epit-agent/.dsh/cyber-wiki', false],
  ['/home/epit-agent/.dsh/skills', '/home/epit-agent/.dsh/skills', false],
  ['/home/epit-agent/projects/deepseek-harness', '/home/epit-agent/projects/deepseek-harness', true],
  ['/home/epit-agent/projects/Cyber-Desk', '/home/epit-agent/projects/Cyber-Desk', true],
  ['/home/epit-agent/projects/Hack-Poc', '/home/epit-agent/projects/Hack-Poc', true],
  ['/run/dsh-kali-broker', '/run/dsh-kali-broker', false],
  ['/run/dsh-kali-broker/vpn.sock', '/run/dsh-kali-broker/vpn.sock', false],
]

function container(id = firstId) {
  return {
    Id: id,
    State: { Running: true },
    HostConfig: {
      NetworkMode: 'none', Privileged: false, PidMode: '', IpcMode: 'private', CgroupnsMode: 'private', UsernsMode: '',
      CapDrop: ['ALL'], CapAdd: ['NET_RAW'], SecurityOpt: ['no-new-privileges:true'],
      Devices: [], DeviceRequests: [], Mounts: [], VolumesFrom: [], Links: [],
      Binds: binds.map(([source, destination, rw]) => `${source}:${destination}:${rw ? 'rw' : 'ro'}`),
    },
    Mounts: binds.map(([Source, Destination, RW]) => ({ Type: 'bind', Source, Destination, RW, Propagation: 'rprivate' })),
  }
}

type Inspection = ReturnType<typeof container>

it('accepts the deployed isolated container including its read-only VPN control socket', () => {
  expect(() => { validateContainer(container()) }).not.toThrow()
})

it.each<[string, (value: Inspection) => void]>([
  ['host networking', (value) => { value.HostConfig.NetworkMode = 'host' }],
  ['privileged container', (value) => { value.HostConfig.Privileged = true }],
  ['extra capability', (value) => { value.HostConfig.CapAdd.push('SYS_ADMIN') }],
  ['missing no-new-privileges', (value) => { value.HostConfig.SecurityOpt = [] }],
  ['extra bind', (value) => { value.HostConfig.Binds.push('/var/run/docker.sock:/var/run/docker.sock:rw') }],
  ['writable VPN control mount', (value) => { value.Mounts.at(-1)!.RW = true }],
  ['missing VPN control mount', (value) => { value.Mounts.pop(); value.HostConfig.Binds.pop() }],
  ['stopped container', (value) => { value.State.Running = false }],
])('rejects %s', (_label, mutate) => {
  const value = container()
  mutate(value)
  expect(() => { validateContainer(value) }).toThrow('isolation requirements')
})

const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  const errors: unknown[] = []
  for (const dispose of cleanup.splice(0).reverse()) {
    try { await dispose() } catch (error) { errors.push(error) }
  }
  if (errors.length) throw new AggregateError(errors, 'Broker fixture cleanup failed')
})

async function listen(server: Server, socketPath: string): Promise<void> {
  const sockets = new Set<Socket>()
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy()
    if (server.listening) await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
    })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve) })
}

async function call(socketPath: string, path: string, method = 'GET', value?: object): Promise<{ status: number; body: string }> {
  const bytes = value === undefined ? '' : JSON.stringify(value)
  return new Promise((resolve, reject) => {
    const child = request({ socketPath, path, method, agent: false, headers: { 'content-length': Buffer.byteLength(bytes) } }, (response) => {
      let body = ''
      response.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
      response.once('error', reject)
      response.once('end', () => { resolve({ status: response.statusCode ?? 0, body }) })
    })
    child.once('error', reject)
    child.end(bytes)
  })
}

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'kb-'))
  cleanup.push(() => { rmSync(dir, { recursive: true }) })
  const dockerSocket = join(dir, 'd.sock'), socketPath = join(dir, 'b.sock')
  const state: {
    live: Inspection | undefined
    requests: string[]
    execs: Map<string, { ContainerID: string; Running: boolean }>
    beforeCreate?: () => void
  } = { live: container(), requests: [], execs: new Map() }
  const docker = createServer((req, res) => {
    void (async () => {
      for await (const _chunk of req) { /* Drain the request before answering the control operation. */ }
      const path = req.url ?? ''
      state.requests.push(`${req.method} ${path}`)
      if (path === `/containers/${name}/json`) {
        const snapshot = state.live === undefined ? undefined : structuredClone(state.live)
        res.writeHead(snapshot === undefined ? 404 : 200)
        res.end(JSON.stringify(snapshot ?? { message: 'No such container' }))
        return
      }
      const create = /^\/containers\/([a-f0-9]{64})\/exec$/.exec(path)
      if (create !== null) {
        state.beforeCreate?.()
        if (state.live?.Id !== create[1]) { res.writeHead(404); res.end('{}'); return }
        const id = (state.execs.size + 1).toString(16).padStart(64, '0')
        state.execs.set(id, { ContainerID: create[1]!, Running: false })
        res.writeHead(201); res.end(JSON.stringify({ Id: id })); return
      }
      const inspect = /^\/exec\/([a-f0-9]{64})\/json$/.exec(path)
      if (inspect !== null && state.execs.has(inspect[1]!)) { res.end(JSON.stringify(state.execs.get(inspect[1]!))); return }
      if (/^\/exec\/[a-f0-9]{64}\/(start|resize)/.test(path)) { res.end('{}'); return }
      res.writeHead(404); res.end('{}')
    })().catch((error: unknown) => res.destroy(error instanceof Error ? error : new Error('Docker fixture failed')))
  })
  await listen(docker, dockerSocket)
  const broker = await createBroker({ dockerSocket, socketPath })
  cleanup.push(() => broker.close())
  return { state, socketPath }
}

// The production listener's filesystem permissions require POSIX Unix sockets.
describe.skipIf(process.platform === 'win32')('dynamic Unix-socket broker', () => {
  it('uses the recreated container without restarting and keeps old execs bound to their original identity', async () => {
    const { state, socketPath } = await fixture()
    const first = await call(socketPath, `/containers/${name}/exec`, 'POST', { Cmd: ['true'] })
    expect(first.status).toBe(201)
    const id = (JSON.parse(first.body) as { Id: string }).Id
    state.live = container(secondId)
    expect(JSON.parse((await call(socketPath, `/containers/${name}/json`)).body)).toMatchObject({ Id: secondId })
    expect((await call(socketPath, `/containers/${secondId}/json`)).status).toBe(200)
    expect((await call(socketPath, `/containers/${firstId}/json`)).status).toBe(403)
    expect((await call(socketPath, `/containers/${name}/exec`, 'POST', { Cmd: ['true'] })).status).toBe(201)
    expect(state.requests).toContain(`POST /containers/${secondId}/exec`)
    expect((await call(socketPath, `/exec/${id}/json`)).status).toBe(200)
    state.execs.set(id, { ContainerID: secondId, Running: false })
    expect((await call(socketPath, `/exec/${id}/json`)).status).toBe(502)
  })

  it('denies an unsafe replacement or a recreation gap, then recovers when an approved container appears', async () => {
    const { state, socketPath } = await fixture()
    state.live = container(secondId)
    state.live.HostConfig.Privileged = true
    expect((await call(socketPath, `/containers/${name}/exec`, 'POST', { Cmd: ['true'] })).status).toBe(502)
    state.live = undefined
    expect((await call(socketPath, `/containers/${name}/exec`, 'POST', { Cmd: ['true'] })).status).toBe(503)
    expect(state.requests.filter(path => path.startsWith('POST'))).toEqual([])
    state.live = container(secondId)
    expect((await call(socketPath, `/containers/${name}/exec`, 'POST', { Cmd: ['true'] })).status).toBe(201)
  })

  it('pins create to the inspected identity and never replays it after a container changes', async () => {
    const { state, socketPath } = await fixture()
    state.beforeCreate = () => { state.live = container(secondId) }
    expect((await call(socketPath, `/containers/${name}/exec`, 'POST', { Cmd: ['true'] })).status).toBe(404)
    expect(state.requests.filter(path => path.startsWith('POST'))).toEqual([`POST /containers/${firstId}/exec`])
    delete state.beforeCreate
    expect((await call(socketPath, `/containers/${name}/exec`, 'POST', { Cmd: ['true'] })).status).toBe(201)
  })

  it('rejects other containers, unknown execs, and privilege escalation without forwarding those operations', async () => {
    const { state, socketPath } = await fixture()
    expect((await call(socketPath, `/containers/${secondId}/json`)).status).toBe(403)
    expect((await call(socketPath, `/containers/${secondId}/exec`, 'POST', { Cmd: ['true'] })).status).toBe(403)
    expect((await call(socketPath, `/exec/${secondId}/start`, 'POST', { Detach: true })).status).toBe(403)
    expect((await call(socketPath, `/containers/${name}/exec`, 'POST', { Cmd: ['true'], Privileged: true })).status).toBe(403)
    expect(state.requests.filter(path => path.startsWith('POST'))).toEqual([])
  })
})
