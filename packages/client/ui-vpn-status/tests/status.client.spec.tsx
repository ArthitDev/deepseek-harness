// @vitest-environment jsdom
import type {} from '../src/client/index.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { VpnStatusSnapshot } from '@deepseek-ai/dsh-host-vpn-status/types'
import { VpnStatusBar, type VpnStatusBarProps } from '../src/client/VpnStatusBar.tsx'
import { en } from '../src/client/locales.ts'
afterEach(()=>{cleanup();vi.useRealTimers()})
const t:VpnStatusBarProps['t']=key=>en[key as keyof typeof en] ?? key
function hook(value:VpnStatusSnapshot,status:'live'|'failed'='live'):GlobalStandardProps['useResource'] {
  return (()=>({ status,value,failure:undefined })) as GlobalStandardProps['useResource']
}
describe('VPN status row',()=>{
  it('shows sampled Host scope and last-check time, then removes expired verification',()=>{
    vi.useFakeTimers();vi.setSystemTime(1700000000000)
    render(<VpnStatusBar t={t} useResource={hook({ state:'verified',evidence:'mullvad',checkedAt:Date.now(),validUntil:Date.now()+1000 })}/>)
    expect(screen.getByText('VPN verified')).toBeTruthy();expect(screen.getByText('Host HTTPS')).toBeTruthy()
    expect(screen.getByText(/Checked.*Z/)).toBeTruthy()
    act(()=>{vi.advanceTimersByTime(1000)})
    expect(screen.getByText('VPN unknown')).toBeTruthy();expect(screen.queryByText('Mullvad')).toBeNull()
  })
  it('never draws retained success on a failed resource',()=>{
    render(<VpnStatusBar t={t} useResource={hook({ state:'verified',evidence:'expected-exit',checkedAt:Date.now(),validUntil:Date.now()+10000 },'failed')}/>)
    expect(screen.getByText('VPN unknown')).toBeTruthy();expect(screen.queryByText('VPN verified')).toBeNull()
  })
  it.each(['checking','unverified','unknown'] as const)('shows %s without provider evidence',(state)=>{
    render(<VpnStatusBar t={t} useResource={hook({ state,evidence:null,checkedAt:null,validUntil:null })}/>)
    expect(screen.getByText(en[state])).toBeTruthy();expect(screen.getByText('No check yet')).toBeTruthy()
  })
})
