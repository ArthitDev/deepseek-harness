/** Restricted Docker exec proxy for the server's approved Kali container. */
import http from 'node:http'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const MAX_BODY = 65536
const EXEC_ID = /^[a-f0-9]{64}$/
const KALI_BINDS = [
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
/**
 * Reject containers whose runtime restrictions or bind mounts differ from this deployment.
 * @param container - Docker inspection response.
 */
export function validateContainer(container) {
  const host = container.HostConfig
  const expected = KALI_BINDS.map(([source, destination, rw]) => `${source}:${destination}:${rw ? 'rw' : 'ro'}`).sort()
  const actual = container.Mounts?.map(mount => mount.Type === 'bind' && mount.Propagation === 'rprivate' ? `${mount.Source}:${mount.Destination}:${mount.RW ? 'rw' : 'ro'}` : '[unapproved mount]').sort()
  if (!EXEC_ID.test(container.Id) || container.State?.Running !== true || host?.NetworkMode !== 'none' || host.Privileged !== false || host.PidMode !== '' || host.IpcMode !== 'private' || host.CgroupnsMode !== 'private' || host.UsernsMode !== '' || !host.CapDrop?.some(cap => cap.toUpperCase() === 'ALL') || host.CapAdd?.length !== 1 || !['NET_RAW', 'CAP_NET_RAW'].includes(host.CapAdd[0]) || host.SecurityOpt?.length !== 1 || host.SecurityOpt[0] !== 'no-new-privileges:true' || ['Devices', 'DeviceRequests', 'Mounts', 'VolumesFrom', 'Links'].some(key => (host[key]?.length ?? 0) !== 0) || JSON.stringify(actual) !== JSON.stringify(expected) || JSON.stringify([...(host.Binds ?? [])].sort()) !== JSON.stringify(expected)) throw new Error('Configured Kali container violates isolation requirements')
}
function failure(status, message) { return Object.assign(new Error(message), { status }) }
function jsonObject(bytes) {
  let value
  try { value = JSON.parse(bytes.toString('utf8')) } catch { throw failure(400, 'Invalid JSON') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure(400, 'Expected JSON object')
  return value
}
function validateStart(value, upgraded) {
  if (Object.keys(value).some(key => !['Detach', 'Tty', 'ConsoleSize'].includes(key))) throw failure(403, 'Unsupported exec start option')
  for (const key of ['Detach', 'Tty']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw failure(400, 'Invalid exec start option')
  if (value.ConsoleSize !== undefined && (!Array.isArray(value.ConsoleSize) || value.ConsoleSize.length !== 2 || !value.ConsoleSize.every(n => Number.isInteger(n) && n > 0 && n <= 65535))) throw failure(400, 'Invalid console size')
  if (upgraded ? value.Detach === true : value.Detach !== true) throw failure(400, 'Attached exec requires upgrade; detached exec requires Detach=true')
  return value
}
async function readBody(request) {
  const chunks = []
  let length = 0
  for await (const chunk of request) { length += chunk.length; if (length > MAX_BODY) throw failure(413, 'Body too large'); chunks.push(chunk) }
  return Buffer.concat(chunks)
}
async function readUpgrade(request, socket, head) {
  const length = request.headers['content-length']
  if (request.headers['transfer-encoding'] !== undefined || !/^\d+$/.test(length ?? '') || Number(length) > MAX_BODY || head.length > MAX_BODY) throw failure(400, 'Invalid upgrade framing')
  const expected = Number(length)
  const aborted = () => { if (!request.complete) request.destroy(failure(400, 'Incomplete upgrade body')) }
  socket.once('close', aborted); socket.once('end', aborted)
  const timer = setTimeout(() => request.destroy(failure(408, 'Upgrade body timeout')), 5000)
  try {
    const body = await readBody(request)
    if (body.length !== expected) throw failure(400, 'Incomplete upgrade body')
    return { body, stdin: head }
  } finally { clearTimeout(timer); socket.off('close', aborted); socket.off('end', aborted) }
}

/**
 * Serve only validated-container inspection and broker-owned exec operations over a private Unix socket.
 * New execs resolve the configured name again; existing execs retain their original container identity.
 * @param options - Docker socket, client socket, and optional configured container name.
 * @returns the startup container identity and a disposer that closes owned connections.
 */
export async function createBroker({ dockerSocket, socketPath, containerName = 'dsh-vpn-kali' }) {
  const controls = new Set()
  const streams = new Set()
  const execs = new Map()
  let reservations = 0
  async function backend(method, path, value) {
    return new Promise((resolve, reject) => {
      const body = value === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(value))
      const request = http.request({ socketPath: dockerSocket, path, method, agent: false, headers: { connection: 'close', 'content-type': 'application/json', 'content-length': body.length } }, response => {
        const chunks = []; let length = 0
        response.on('data', chunk => { length += chunk.length; if (length > 2 * 1024 * 1024) request.destroy(failure(502, 'Backend response too large')); else chunks.push(chunk) })
        response.once('error', reject)
        response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }))
      })
      controls.add(request); request.once('close', () => controls.delete(request))
      request.setTimeout(10000, () => request.destroy(failure(504, 'Docker control timeout')))
      request.once('error', reject); request.end(body)
    })
  }
  async function configuredContainer() {
    const result = await backend('GET', `/containers/${containerName}/json`)
    if (result.status !== 200) throw failure(503, 'Configured Kali container unavailable')
    const container = jsonObject(result.body)
    validateContainer(container)
    return { result, container }
  }
  const { container } = await configuredContainer()
  const containerId = container.Id
  function route(request) {
    const raw = request.url ?? ''
    if (raw.length > 512 || /[%\\#]/.test(raw)) throw failure(403, 'Path denied')
    const path = raw.replace(/^\/v\d+\.\d+(?=\/)/, '')
    if (['GET', 'HEAD'].includes(request.method) && path === '/_ping') return { kind: 'ping', path: '/_ping' }
    if (request.method === 'GET' && path === '/version') return { kind: 'version', path }
    const inspect = path.match(/^\/containers\/([a-zA-Z0-9][a-zA-Z0-9_.-]*)\/json$/)
    if (request.method === 'GET' && inspect && (inspect[1] === containerName || EXEC_ID.test(inspect[1]))) return { kind: 'container', requestedId: inspect[1] }
    if (request.method === 'POST' && path === `/containers/${containerName}/exec`) return { kind: 'create' }
    const match = path.match(/^\/exec\/([a-f0-9]{64})\/(json|start|resize)(\?h=(\d+)&w=(\d+))?$/)
    if (!match || !execs.has(match[1])) throw failure(403, 'Exec not owned by this broker')
    const [, id, action, query, height, width] = match
    const record = execs.get(id)
    if (action === 'json' && request.method === 'GET' && query === undefined) return { kind: 'inspect', path, id, record }
    if (action === 'start' && request.method === 'POST' && query === undefined) return { kind: 'start', path, id, record }
    if (action === 'resize' && request.method === 'POST' && query !== undefined && [height, width].every(n => Number(n) > 0 && Number(n) <= 65535)) return { kind: 'resize', path, id, record }
    throw failure(403, 'Operation denied')
  }
  function validateCreate(value) {
    const allowed = ['AttachStdin', 'AttachStdout', 'AttachStderr', 'DetachKeys', 'Tty', 'Env', 'Cmd', 'User', 'Privileged', 'WorkingDir', 'ConsoleSize']
    if (Object.keys(value).some(key => !allowed.includes(key))) throw failure(403, 'Unsupported exec option')
    if (value.Privileged !== undefined && value.Privileged !== false) throw failure(403, 'Privileged exec denied')
    if (value.User !== undefined && !['', 'root', '0', '0:0'].includes(value.User)) throw failure(403, 'Only Kali root is configured')
    for (const key of ['AttachStdin', 'AttachStdout', 'AttachStderr', 'Tty']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw failure(400, 'Invalid attach option')
    if (!Array.isArray(value.Cmd) || value.Cmd.length < 1 || value.Cmd.length > 1024 || !value.Cmd.every(arg => typeof arg === 'string' && !arg.includes('\0'))) throw failure(400, 'Invalid command')
    if (value.Env != null && (!Array.isArray(value.Env) || value.Env.length > 256 || !value.Env.every(arg => typeof arg === 'string' && !arg.includes('\0')))) throw failure(400, 'Invalid environment')
    for (const key of ['WorkingDir', 'DetachKeys']) if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].includes('\0'))) throw failure(400, 'Invalid exec text option')
    if (value.ConsoleSize !== undefined) validateStart({ Detach: true, ConsoleSize: value.ConsoleSize }, false)
    if (execs.size + reservations >= 4096) throw failure(503, 'Exec registry full; finish commands before retrying')
    return { ...value, Privileged: false, User: 'root' }
  }
  function reply(response, status, bytes = Buffer.alloc(0), headers = {}) { response.writeHead(status, { 'content-type': 'application/json', 'content-length': bytes.length, ...headers }); response.end(bytes) }
  function errorReply(response, error) { reply(response, error.status ?? 502, Buffer.from(JSON.stringify({ message: error.status ? error.message : 'Kali broker backend unavailable' }))) }
  const server = http.createServer({ maxHeaderSize: 8192 }, (request, response) => {
    void (async () => {
      const selected = route(request)
      let value
      if (selected.kind === 'create') value = validateCreate(jsonObject(await readBody(request)))
      else if (selected.kind === 'start') { value = validateStart(jsonObject(await readBody(request)), false); selected.record.started = true }
      else if ((await readBody(request)).length !== 0) throw failure(400, 'Unexpected request body')
      let result
      if (selected.kind === 'create') reservations++
      try {
        let admittedContainerId
        if (selected.kind === 'container' || selected.kind === 'create') {
          const current = await configuredContainer()
          admittedContainerId = current.container.Id
          if (selected.kind === 'container') {
            if (selected.requestedId !== containerName && selected.requestedId !== admittedContainerId) throw failure(403, 'Container identity denied')
            result = current.result
          } else result = await backend('POST', `/containers/${admittedContainerId}/exec`, value)
        } else result = await backend(selected.kind === 'ping' ? 'GET' : request.method, selected.path, value)
        if (selected.kind === 'create' && result.status === 201) {
          const id = jsonObject(result.body).Id
          if (!EXEC_ID.test(id)) throw failure(502, 'Invalid exec identity')
          execs.set(id, { started: false, containerId: admittedContainerId })
        }
      } finally { if (selected.kind === 'create') reservations-- }
      if (selected.kind === 'inspect' && result.status === 200) {
        const state = jsonObject(result.body)
        if (state.ContainerID !== selected.record.containerId) throw failure(502, 'Exec container changed')
        if (selected.record.started && !state.Running) execs.delete(selected.id)
      }
      const headers = selected.kind === 'ping' ? { 'api-version': result.headers['api-version'] ?? '1.41' } : {}
      reply(response, result.status, request.method === 'HEAD' ? Buffer.alloc(0) : result.body, headers)
    })().catch(error => { if (!response.headersSent) errorReply(response, error); else response.destroy() })
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  server.maxConnections = 128
  server.on('connection', socket => { streams.add(socket); socket.once('close', () => streams.delete(socket)); socket.on('error', () => {}) })
  server.on('upgrade', (request, client, head) => {
    client.on('error', () => client.destroy())
    client.pause()
    void (async () => {
      const selected = route(request)
      if (selected.kind !== 'start' || String(request.headers.upgrade).toLowerCase() !== 'tcp') throw failure(403, 'Upgrade denied')
      const { body, stdin } = await readUpgrade(request, client, head)
      const value = validateStart(jsonObject(body), true)
      const bytes = Buffer.from(JSON.stringify(value))
      const upstream = http.request({ socketPath: dockerSocket, path: selected.path, method: 'POST', agent: false, headers: { connection: 'Upgrade', upgrade: 'tcp', 'content-type': 'application/json', 'content-length': bytes.length } })
      controls.add(upstream); upstream.once('close', () => controls.delete(upstream))
      const timer = setTimeout(() => upstream.destroy(failure(504, 'Docker upgrade timeout')), 10000)
      client.once('close', () => { clearTimeout(timer); upstream.destroy() })
      upstream.once('response', response => { clearTimeout(timer); response.resume(); client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n') })
      upstream.once('error', () => { clearTimeout(timer); client.destroy() })
      upstream.once('upgrade', (response, socket, first) => {
        clearTimeout(timer)
        if (response.statusCode !== 101 || client.destroyed) { socket.destroy(); client.destroy(); return }
        selected.record.started = true
        streams.add(socket); socket.once('close', () => { streams.delete(socket); client.destroy() }); socket.on('error', () => client.destroy())
        client.once('close', () => socket.destroy())
        client.write('HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n')
        if (first.length) client.write(first)
        if (stdin.length) socket.write(stdin)
        client.pipe(socket); socket.pipe(client); client.resume()
      })
      upstream.end(bytes)
    })().catch(error => { console.error(JSON.stringify({ event: 'exec-upgrade-rejected', reason: error.status ? error.message : 'Kali broker unavailable', complete: request.complete, contentLength: request.headers['content-length'], headLength: head.length })); if (!client.destroyed && !client.writableEnded) { const bytes = Buffer.from(JSON.stringify({ message: error.status ? error.message : 'Kali broker unavailable' })); client.end(`HTTP/1.1 ${error.status ?? 502} Denied\r\nConnection: close\r\nContent-Length: ${bytes.length}\r\n\r\n${bytes}`) } })
  })
  server.on('clientError', (_error, socket) => socket.destroy())
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve) })
  fs.chmodSync(socketPath, 0o660)
  return { containerId, async close() { const closed = new Promise(resolve => server.close(resolve)); for (const request of controls) request.destroy(); for (const socket of streams) socket.destroy(); await closed } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const broker = await createBroker({ dockerSocket: '/run/docker.sock', socketPath: '/run/dsh-kali-broker/docker.sock' })
  console.log('Fixed Kali exec broker ready')
  let closing = false
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (!closing) { closing = true; void broker.close().then(() => process.exit(0), () => process.exit(1)) } })
}
