import { describe, expect, it } from 'vitest'
import { canUseHostSettings } from '../src/client/host-settings-access.ts'

describe('canUseHostSettings', () => {
  it('allows only loopback or this build exact Tailnet origins', () => {
    expect(canUseHostSettings(true, undefined)).toBe(true)
    expect(canUseHostSettings(false, {
      protocol: 'https:', hostname: 'msi-cyborg-15-nb.tailaa5429.ts.net',
    })).toBe(true)
    expect(canUseHostSettings(false, {
      protocol: 'http:', hostname: 'msi-cyborg-15-nb.tailaa5429.ts.net',
    })).toBe(false)
    expect(canUseHostSettings(false, {
      protocol: 'https:', hostname: 'another-device.tailaa5429.ts.net',
    })).toBe(false)
    expect(canUseHostSettings(false, {
      protocol: 'http:', hostname: '100.123.30.41',
    })).toBe(true)
    expect(canUseHostSettings(false, {
      protocol: 'https:', hostname: '100.123.30.41',
    })).toBe(false)
    expect(canUseHostSettings(false, {
      protocol: 'http:', hostname: '100.123.30.42',
    })).toBe(false)
  })
})
