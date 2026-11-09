/** Legacy MCP fixture with startup, request and final stderr diagnostics. */
import { createInterface } from 'node:readline'

const ready = Buffer.from('พร้อม\r\n')
process.stderr.write(ready.subarray(0, 2))
process.stderr.write(ready.subarray(2))
process.stdin.once('end', () => {
  process.stderr.write('final diagnostic', () => process.exit(0))
})
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  if (request.method === 'server/discover') {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id,
      error: { code: -32601, message: 'Legacy server' } })}\n`)
    return
  }
  process.stderr.write(`${request.method}: ${process.env.FIXTURE_TOKEN ?? 'no token'}\n`)
  if (process.argv.includes('--fail')) {
    process.exit(1)
  }
  const result = request.method === 'initialize'
    ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'noisy', version: '1' } }
    : { tools: [] }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`)
})
