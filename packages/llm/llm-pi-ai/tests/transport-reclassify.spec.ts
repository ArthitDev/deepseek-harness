import { describe, expect, it } from 'vitest'
import type { ModelProxyOutcome } from '@deepseek-ai/dsh-http-proxy'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { reclassifyTransportFailure, sharpenTransportFinish } from '../src/stream.ts'

const proxied = (partial: Partial<ModelProxyOutcome>): ModelProxyOutcome =>
  ({ endpoint: 'http://127.0.0.1:18899', ...partial })

describe('reclassifyTransportFailure', () => {
  it('keeps the failure untouched without a proxy outcome', () => {
    const failure = { message: 'Connection error.', code: 'TRANSPORT' as const }
    expect(reclassifyTransportFailure(failure, undefined)).toBe(failure)
  })

  it('maps a provider 403 seen through the tunnel to AUTH', () => {
    const sharp = reclassifyTransportFailure(
      { message: 'Connection error.', code: 'TRANSPORT' },
      proxied({ lastStatus: 403 }),
    )
    expect(sharp.code).toBe('AUTH')
    expect(sharp.message).toContain('HTTP 403')
    expect(sharp.message).toContain('http://127.0.0.1:18899')
  })

  it('maps other tunneled statuses to their retry-policy codes', () => {
    for (const [status, code] of [[401, 'AUTH'], [429, 'RATE_LIMIT'], [502, 'SERVER'], [400, 'INVALID_REQUEST'], [413, 'INVALID_REQUEST']] as const) {
      expect(reclassifyTransportFailure(
        { message: 'Connection error.', code: 'TRANSPORT' },
        proxied({ lastStatus: status }),
      ).code).toBe(code)
    }
  })

  it('keeps TRANSPORT and names the proxy origin for a tunneled transport error', () => {
    const sharp = reclassifyTransportFailure(
      { message: 'Connection error.', code: 'TRANSPORT' },
      proxied({ lastError: 'Proxy authentication failed' }),
    )
    expect(sharp.code).toBe('TRANSPORT')
    expect(sharp.message).toContain('proxy http://127.0.0.1:18899 transport failed')
    expect(sharp.message).toContain('Proxy authentication failed')
  })

  it('never leaks proxy credentials into the message', () => {
    const sharp = reclassifyTransportFailure(
      { message: 'Connection error.', code: 'TRANSPORT' },
      { endpoint: 'http://dsh:secret-token@127.0.0.1:18899', lastStatus: 403 },
    )
    expect(sharp.message).not.toContain('secret-token')
    expect(sharp.message).toContain('http://127.0.0.1:18899')
  })

  it('returns the original failure when the proxy arm observed nothing', () => {
    const failure = { message: 'Connection error.', code: 'TRANSPORT' as const }
    expect(reclassifyTransportFailure(failure, proxied({}))).toBe(failure)
  })
})

describe('sharpenTransportFinish', () => {
  const finishChunk = (code: string, message: string): StreamChunk =>
    ({ type: 'finish', reason: { kind: 'error', failure: { code, message } } })

  it('rewraps a transport failure with the recorded provider status', () => {
    const sharpened = sharpenTransportFinish(
      finishChunk('TRANSPORT', 'Connection error.'),
      proxied({ lastStatus: 403 }),
    )
    if (sharpened.type !== 'finish' || sharpened.reason.kind !== 'error') throw new Error('not an error finish')
    expect(sharpened.reason.failure.code).toBe('AUTH')
    expect(sharpened.reason.failure.message).toContain('HTTP 403')
    expect(sharpened.reason.failure.message).toContain('http://127.0.0.1:18899')
  })

  it('leaves non-transport failures untouched', () => {
    const chunk = finishChunk('AUTH', 'bad key')
    expect(sharpenTransportFinish(chunk, proxied({ lastStatus: 500 }))).toBe(chunk)
  })

  it('leaves chunks that were not proxied', () => {
    const chunk = finishChunk('TRANSPORT', 'Connection error.')
    expect(sharpenTransportFinish(chunk, undefined)).toBe(chunk)
  })
})
