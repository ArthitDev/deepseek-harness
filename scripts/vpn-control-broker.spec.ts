import { request, type Server } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { createVpnControlServer } from './vpn-control-broker.mjs'

let server: Server | undefined
afterEach(async () => {
  if (server !== undefined) await new Promise<void>((resolve, reject) => {
    server!.close((error) => { if (error) reject(error); else resolve() })
  })
})

async function start(run: Parameters<typeof createVpnControlServer>[0]): Promise<number> {
  server = createVpnControlServer(run)
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing test listener')
  return address.port
}

async function call(port: number, path: string, method = 'GET', body = ''): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, agent: false, headers: { 'content-length': Buffer.byteLength(body) } }, (res) => {
      let text = ''
      res.on('data', (part: Buffer) => { text += part.toString('utf8') })
      res.on('end', () => { resolve({ status: res.statusCode!, body: text }) })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end(body)
  })
}

it('admits only the two fixed operations and never returns account/address data', async () => {
  const run = vi.fn(async () => ({ state: 'connected', account: 'private', ip: '203.0.113.7' }))
  const port = await start(run)
  expect(await call(port, '/status')).toEqual({ status: 200, body: '{"state":"connected"}' })
  for (const [path, method, body] of [
    ['/reconnect', 'GET', ''], ['/status', 'POST', ''], ['/reconnect?command=disconnect', 'POST', ''],
    ['/reconnect', 'POST', 'disconnect'], ['/exec', 'POST', ''],
  ]) expect((await call(port, path!, method, body)).status).toBe(400)
  expect(run).toHaveBeenCalledExactlyOnceWith('status')
})

it('rejects overlapping reconnects across clients, then releases the operation after failure', async () => {
  const pending = Promise.withResolvers<{ state: string }>()
  const run = vi.fn<Parameters<typeof createVpnControlServer>[0]>().mockReturnValueOnce(pending.promise).mockResolvedValue({ state: 'connected' })
  const port = await start(run)
  const first = call(port, '/reconnect', 'POST')
  await vi.waitFor(() => { expect(run).toHaveBeenCalledOnce() })
  expect((await call(port, '/reconnect', 'POST')).status).toBe(409)
  expect((await call(port, '/status')).status).toBe(200)
  pending.reject(new Error('secret detail'))
  expect(await first).toEqual({ status: 503, body: '{"error":"control-failed"}' })
  expect((await call(port, '/reconnect', 'POST')).status).toBe(200)
  expect(run.mock.calls.map(args => args[0])).toEqual(['reconnect', 'status', 'reconnect'])
})
