import { describe, expect, it } from 'vitest'
import { exitMatcher, verifyResponse } from '../src/probe.ts'

describe('VPN egress evidence', () => {
  it('accepts official Mullvad attestation only with a valid IP and boolean', () => {
    expect(verifyResponse({ ip:'203.0.113.2',mullvad_exit_ip:true },exitMatcher([]))).toEqual({ state:'verified',evidence:'mullvad' })
    for(const value of [null,{}, { ip:'invalid',mullvad_exit_ip:true }, { ip:'203.0.113.2',mullvad_exit_ip:'true' }, { ip:'203.0.113.2' }]) {
      expect(verifyResponse(value,exitMatcher(['203.0.113.0/24'])).state).toBe('unknown')
    }
  })
  it('matches configured IPv4/IPv6 VPN exits without trusting an ordinary public IP', () => {
    const match=exitMatcher(['203.0.113.0/24','2001:db8::/32','192.0.2.7'])
    for(const ip of ['203.0.113.255','2001:db8::42','192.0.2.7']) expect(verifyResponse({ ip,mullvad_exit_ip:false },match)).toEqual({ state:'verified',evidence:'expected-exit' })
    for(const ip of ['203.0.114.1','2001:db9::1','192.0.2.8']) expect(verifyResponse({ ip,mullvad_exit_ip:false },match)).toEqual({ state:'unverified',evidence:null })
    expect(verifyResponse({ ip:'203.0.113.2',mullvad_exit_ip:false },exitMatcher([])).state).toBe('unverified')
  })
  it.each(['bad','1.2.3.4/33','1.2.3.4/-1','1.2.3.4/0','::/0','::/129','1.2.3.4/a','1.2.3.4/24/extra'])('refuses invalid or universal exit range %s', (entry)=>{
    expect(()=>exitMatcher([entry])).toThrow()
  })
})
