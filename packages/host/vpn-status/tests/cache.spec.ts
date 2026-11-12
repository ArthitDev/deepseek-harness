import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import VpnStatusService from '../src/index.ts'
import { fetchEgress } from '../src/probe.ts'
vi.mock('../src/probe.ts', async original => ({ ...await original<typeof import('../src/probe.ts')>(),fetchEgress:vi.fn() }))
const fetchMock=vi.mocked(fetchEgress)
const config={ enabled:true,intervalMs:300000,timeoutMs:10000,expectedExitCidrs:[] }
let ctx:Context
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(1700000000000);ctx=new Context();fetchMock.mockReset()})
afterEach(async()=>{await ctx.fiber.dispose();vi.useRealTimers()})
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve()}
describe('shared VPN cache',()=>{
  it('checks once on startup and once per five minutes, never from readers',async()=>{
    fetchMock.mockResolvedValue({ ip:'203.0.113.7',mullvad_exit_ip:true })
    await ctx.plugin(VpnStatusService,config);await flush()
    const service=ctx.vpnStatus
    expect(service.read().state).toBe('verified')
    for(let i=0;i<20;i++)service.read()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(299999);expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1);expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(service.read())).not.toContain('203.0.113.7')
  })
  it('returns unknown after expiry and replaces success with a failed check',async()=>{
    fetchMock.mockResolvedValueOnce({ ip:'203.0.113.7',mullvad_exit_ip:true }).mockRejectedValue(new Error('offline'))
    await ctx.plugin(VpnStatusService,config);await flush()
    vi.setSystemTime(Date.now()+300000);expect(ctx.vpnStatus.read()).toMatchObject({ state:'unknown',evidence:null })
    await vi.advanceTimersByTimeAsync(300000);expect(ctx.vpnStatus.read()).toMatchObject({ state:'unknown',evidence:null })
  })
  it('does not send external traffic while disabled',async()=>{
    await ctx.plugin(VpnStatusService,{ ...config,enabled:false })
    expect(ctx.vpnStatus.read().state).toBe('unknown');expect(fetchMock).not.toHaveBeenCalled()
  })
  it('cancels and awaits an in-flight probe on disposal without another poll',async()=>{
    let signal:AbortSignal|undefined
    let finished=false
    fetchMock.mockImplementation((s)=>{signal=s;return new Promise((_resolve,reject)=>{ s.addEventListener('abort',()=>{finished=true;reject(new Error('aborted'))},{ once:true }) })})
    await ctx.plugin(VpnStatusService,config);expect(ctx.vpnStatus.read().state).toBe('checking')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose();expect(signal?.aborted).toBe(true);expect(finished).toBe(true)
    await vi.advanceTimersByTimeAsync(600000);expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
