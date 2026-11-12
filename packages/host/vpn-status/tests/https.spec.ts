import { EventEmitter } from 'node:events'
import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import type { RequestOptions } from 'node:https'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchEgress } from '../src/probe.ts'
type MockRequest = (url: string, options: RequestOptions, callback: (res: IncomingMessage) => void) => EventEmitter & { end: () => void }
const mocks = vi.hoisted(() => ({ request: vi.fn<MockRequest>() }))
vi.mock('node:https',()=>({ request:mocks.request }))
let response:IncomingMessage
let req:EventEmitter & { end:()=>void }
let socket:Socket
beforeEach(()=>{
  socket=new Socket();response=new IncomingMessage(socket);response.statusCode=200
  response.headers={ 'content-type':'application/json' }
  req=Object.assign(new EventEmitter(),{ end:()=>{} })
  mocks.request.mockReset().mockImplementation((_url, _options, callback) => {
    queueMicrotask(() => { callback(response) })
    return req
  })
})
afterEach(()=>{response.destroy();socket.destroy()})
const flush=async()=>{await Promise.resolve()}
describe('official HTTPS egress request',()=>{
  it('uses only the official TLS origin, no credentials, and a new nonce',async()=>{
    const signal=new AbortController().signal
    const first=fetchEgress(signal);await flush()
    response.emit('data',Buffer.from('{"ip":"203.0.113.7","mullvad_exit_ip":true}'));response.emit('end')
    await expect(first).resolves.toMatchObject({ mullvad_exit_ip:true })
    const call=mocks.request.mock.calls[0]
    if (call===undefined) throw new Error('Missing HTTPS call')
    const [url,options]=call
    expect(url).toMatch(/^https:\/\/am\.i\.mullvad\.net\/json\?dsh=/)
    expect(options).toEqual({ signal,agent:false,headers:{ accept:'application/json','cache-control':'no-cache' } })
    const second=fetchEgress(signal);await flush();response.emit('data',Buffer.from('{}'));response.emit('end');await second
    expect(mocks.request.mock.calls[1]![0]).not.toBe(url)
  })
  it.each([302,403,500])('refuses HTTP %s without following redirects',async (status)=>{
    response.statusCode=status
    await expect(fetchEgress(new AbortController().signal)).rejects.toThrow('endpoint unavailable')
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })
  it('rejects oversized and malformed JSON bodies',async()=>{
    const oversized=fetchEgress(new AbortController().signal);await flush()
    response.emit('data',Buffer.alloc(16385))
    await expect(oversized).rejects.toThrow('too large')
  })
  it('rejects malformed JSON and response errors',async()=>{
    const pending=fetchEgress(new AbortController().signal);await flush()
    response.emit('data',Buffer.from('{'));response.emit('end')
    await expect(pending).rejects.toThrow()
  })
  it('rejects a request error, including cancellation',async()=>{
    const pending=fetchEgress(new AbortController().signal)
    req.emit('error',new Error('aborted'))
    await expect(pending).rejects.toThrow('aborted')
  })
})
