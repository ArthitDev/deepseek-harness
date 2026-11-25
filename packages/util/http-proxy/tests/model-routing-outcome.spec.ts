import { expect, it, onTestFinished } from 'vitest'
import { createServer, type Server } from 'node:http'
import { connect as tcpConnect, type AddressInfo } from 'node:net'
import { installModelProxyDispatcher, modelProxyOutcomeForCall } from '../src/model-routing.ts'

/** A forward-proxy fixture: answers CONNECT with `connectStatus`, then pipes the tunnel. */
async function fixtureProxy(connectStatus: number): Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createServer(() => { })
  server.on('connect', (req, client, head) => {
    const target = new URL(`http://${req.url ?? ''}`)
    const upstream = tcpConnect(Number(target.port), target.hostname)
    upstream.once('connect', () => {
      client.write(`HTTP/1.1 ${String(connectStatus)} Fixture Answer\r\n\r\n`)
      if (connectStatus === 200) {
        if (head.length > 0) upstream.write(head)
        client.pipe(upstream)
        upstream.pipe(client)
      } else { client.end(); upstream.destroy() }
    })
    upstream.once('error', () => { client.end() })
    client.once('error', () => upstream.destroy())
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', () => resolve()) })
  const port = (server.address() as AddressInfo).port
  return { port, close: () => new Promise((resolve) => { server.close(() => resolve()) }) }
}

it('records the tunneled provider status for in-scope requests', async () => {
  const provider = createServer((_req, res) => { res.writeHead(403); res.end('forbidden by provider') })
  await new Promise<void>((resolve) => { provider.listen(0, '127.0.0.1', () => resolve()) })
  onTestFinished(() => { provider.close() })
  const providerPort = (provider.address() as AddressInfo).port

  const fixture = await fixtureProxy(200)
  onTestFinished(() => fixture.close())
  const scope = await installModelProxyDispatcher(new URL(`http://127.0.0.1:${String(fixture.port)}`))
  onTestFinished(() => scope.dispose())
  const seen = await scope.run(async () => {
    const response = await fetch(`http://127.0.0.1:${String(providerPort)}/v1/models`)
    const body = await response.text()
    const oc = modelProxyOutcomeForCall()
    return { status: response.status, outcome: oc, body }
  })
  expect(seen.body).toBe('forbidden by provider')
  expect(seen.outcome?.lastStatus).toBe(403)
  expect(seen.outcome?.endpoint).toBe(`http://127.0.0.1:${String(fixture.port)}`)
})
