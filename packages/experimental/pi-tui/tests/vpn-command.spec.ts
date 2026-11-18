import { stripVTControlCharacters } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import VpnStatusService from '@deepseek-ai/dsh-host-vpn-status'
import { fetchEgress } from '../../../host/vpn-status/src/probe.ts'
import { controlVpn } from '../../../host/vpn-status/src/control.ts'
import { TuiAltScreen, type Terminal } from '@earendil-works/pi-tui'
import { ChatScreen } from '../src/ui/chat.ts'
import { fixtureAgent } from './fixture-agent.ts'

vi.mock('../../../host/vpn-status/src/probe.ts', async original => ({ ...await original<typeof import('../../../host/vpn-status/src/probe.ts')>(), fetchEgress: vi.fn() }))
vi.mock('../../../host/vpn-status/src/control.ts', () => ({ controlVpn: vi.fn() }))

it('routes operator VPN commands without model turns and distinguishes reconnect from egress verification', async () => {
  const ctx = new Context()
  const root = await mkdtemp(join(tmpdir(), 'dsh-vpn-command-'))
  const startInput = vi.fn<Terminal['start']>()
  let columns = 160
  const terminal: Terminal = { get columns() { return columns }, rows: 60, kittyProtocolActive: false,
    start: startInput, stop: vi.fn(), drainInput: async () => {}, write: vi.fn(), moveBy: vi.fn(),
    hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(), clearFromCursor: vi.fn(),
    clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(), setProgramStatus: vi.fn() }
  const tui = new TuiAltScreen(terminal)
  let screen!: ChatScreen
  const followup = vi.fn()
  const visible = (): string => { tui.renderNow(); return stripVTControlCharacters(tui.getScreenLines().join('\n')) }
  const input = (data: string): void => { startInput.mock.calls[0]?.[0](data) }
  try {
    vi.mocked(fetchEgress).mockResolvedValue({ ip: '203.0.113.7', mullvad_exit_ip: true, mullvad_exit_ip_hostname: 'sg-sin-wg-101' })
    vi.mocked(controlVpn).mockResolvedValue({ kind: 'ok', tunnel: 'connected' })
    await ctx.plugin(Loader)
    Object.assign(ctx.loader.builtins, {
      include: Include, sessions: SessionStore, vpn: VpnStatusService,
      screen: { name: 'vpn-screen-fixture', inject: ['sessions', 'vpnStatus'], apply: (screenCtx: Context) => {
        const agent = fixtureAgent(screenCtx, screenCtx.sessions.create(SessionId('vpn-commands')))
        agent.followup = followup
        screen = new ChatScreen({ ctx: screenCtx, tui, agent, config: { cwd: root }, onQuit: vi.fn() })
      } },
    })
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, JSON.stringify([
      { name: 'cordis:sessions' },
      { name: 'cordis:vpn', config: { enabled: true, intervalMs: 300000, timeoutMs: 10000, expectedExitCidrs: [] } },
      { name: 'cordis:screen' },
    ]))
    await ctx.loader.root.update([{ id: 'include', name: 'cordis:include', config: { path: pathToFileURL(configPath).href } }])
    await ctx.loader.await()
    expect(screen).toBeDefined()
    tui.start()
    screen.submit('/vpn disconnect')
    await vi.waitFor(() => { expect(visible()).toContain('usage: /vpn [status|reconnect|rotate asia|europe|americas|oceania|africa|any]') })
    await vi.waitFor(() => { expect(ctx.vpnStatus.read().state).toBe('verified') })
    expect(visible()).toContain('VPN verified (mullvad) · SG')
    const show = vi.spyOn(tui, 'showOverlay')
    screen.submit('/vpn')
    screen.submit('/vpn')
    expect(show).toHaveBeenCalledOnce()
    expect(visible()).toContain('1. Status')
    expect(visible()).toContain('2. Reconnect')
    expect(visible()).toContain('shared traffic may pause')
    expect(visible().split('\n').filter(line => /1\. Status|2\. Reconnect|Rotate →|↑\/↓ or number/.test(line)))
      .toMatchSnapshot('VPN action picker')
    expect(vi.mocked(controlVpn)).not.toHaveBeenCalled()
    columns = 72
    tui.requestRender(true)
    expect(visible()).toContain('1. Status')
    expect(visible()).toContain('2. Reconnect')
    expect(tui.getScreenLines().map(stripVTControlCharacters).every(line => line.length <= terminal.columns)).toBe(true)
    input('\x1b')
    await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(false) })
    expect(vi.mocked(controlVpn)).not.toHaveBeenCalled()
    columns = 160
    tui.requestRender(true)
    input('/vpn')
    input('\r')
    await vi.waitFor(() => { expect(tui.hasOverlay()).toBe(true) })
    input('\x1b[B')
    expect(visible()).toContain('→ 2. Reconnect')
    input('\x1b[A')
    input('\r')
    await vi.waitFor(() => { expect(visible()).toContain('VPN tunnel: connected (ok)') })
    expect(vi.mocked(controlVpn)).toHaveBeenCalledExactlyOnceWith('status', '', expect.any(AbortSignal))
    expect(tui.hasOverlay()).toBe(false)
    screen.submit('/vpn status')
    await vi.waitFor(() => { expect(visible()).toContain('VPN tunnel: connected (ok)') })
    expect(visible()).toContain('Host HTTPS: verified (mullvad)')
    vi.mocked(fetchEgress).mockRejectedValue(new Error('timeout'))
    screen.submit('/vpn')
    input('2')
    expect(visible()).toContain('→ 2. Reconnect')
    expect(vi.mocked(controlVpn)).toHaveBeenCalledTimes(2)
    input('\r')
    await vi.waitFor(() => { expect(ctx.vpnStatus.read().state).toBe('unknown') })
    expect(vi.mocked(controlVpn)).toHaveBeenLastCalledWith('reconnect', '', expect.any(AbortSignal))
    expect(tui.hasOverlay()).toBe(false)
    screen.submit('/vpn reconnect')
    await vi.waitFor(() => { expect(vi.mocked(controlVpn)).toHaveBeenCalledTimes(4) })
    await vi.waitFor(() => { expect(ctx.vpnStatus.read().state).toBe('unknown') })
    await vi.waitFor(() => { expect(visible()).toContain('VPN reconnect completed; Host HTTPS unknown. Egress is not confirmed.') })
    expect(visible()).not.toContain('VPN reconnected; Host HTTPS egress verified.')
    expect(ctx.vpnStatus.read().state).toBe('unknown')
    expect(visible().split('\n').filter(line => line.includes('VPN reconnect completed')).slice(-1)
      .map(line => line.split('│')[0]!.trim())).toMatchSnapshot('reconnect without verified egress')
    // Rotate: direct country argument routes to the broker rotate operation and reports the relay.
    vi.mocked(fetchEgress).mockResolvedValue({ ip: '203.0.113.7', mullvad_exit_ip: true })
    vi.mocked(controlVpn).mockResolvedValue({ kind: 'ok', tunnel: 'connected', relay: 'sg-sin-wg-101' })
    screen.submit('/vpn rotate')
    await vi.waitFor(() => { expect(visible()).toContain('usage: /vpn rotate asia|europe|americas|oceania|africa|any') })
    screen.submit('/vpn rotate sg')
    await vi.waitFor(() => { expect(visible()).toContain('VPN rotated (target: sg); Host HTTPS egress verified. Exit relay: sg-sin-wg-101.') })
    expect(vi.mocked(controlVpn)).toHaveBeenLastCalledWith('rotate', '', expect.any(AbortSignal), 'sg')
    screen.submit('/vpn rotate zz')
    // Two-letter codes pass TUI validation; the broker whitelist rejects unknown countries (400) at runtime.
    await vi.waitFor(() => { expect(vi.mocked(controlVpn)).toHaveBeenLastCalledWith('rotate', '', expect.any(AbortSignal), 'zz') })
    // Region rotate: a region name routes to the broker region query and reports the picked country.
    vi.mocked(controlVpn).mockResolvedValue({ kind: 'ok', tunnel: 'connected', relay: 'nz-akl-wg-302' })
    screen.submit('/vpn rotate oceania')
    await vi.waitFor(() => { expect(visible()).toContain('VPN rotated (target: oceania); Host HTTPS egress verified. Exit relay: nz-akl-wg-302.') })
    expect(vi.mocked(controlVpn)).toHaveBeenLastCalledWith('rotate', '', expect.any(AbortSignal), 'oceania')
    expect(followup).not.toHaveBeenCalled()
    const calls = vi.mocked(controlVpn).mock.calls.length
    input('/vpn ')
    await vi.waitFor(() => { expect(visible()).toContain('View VPN status') })
    expect(visible()).toContain('Reconnect VPN')
    expect(visible().split('\n').filter(line => /View VPN status|Reconnect VPN/.test(line)))
      .toMatchSnapshot('VPN command suggestions')
    input('\x1b[B')
    expect(visible()).toContain('→ Reconnect VPN')
    columns = 72
    tui.requestRender(true)
    expect(visible()).toContain('Reconnect VPN')
    expect(tui.getScreenLines().map(stripVTControlCharacters).every(line => line.length <= terminal.columns)).toBe(true)
    columns = 160
    tui.requestRender(true)
    expect(vi.mocked(controlVpn)).toHaveBeenCalledTimes(calls)
    input('\x1b')
    expect(visible()).not.toContain('View VPN status')
    expect(vi.mocked(controlVpn)).toHaveBeenCalledTimes(calls)
    input('\x7f')
    input(' ')
    await vi.waitFor(() => { expect(visible()).toContain('View VPN status') })
    input('\r')
    expect(vi.mocked(controlVpn)).toHaveBeenCalledTimes(calls)
    input('\r')
    await vi.waitFor(() => { expect(vi.mocked(controlVpn)).toHaveBeenCalledTimes(calls + 1) })
    expect(vi.mocked(controlVpn)).toHaveBeenLastCalledWith('status', '', expect.any(AbortSignal))
    input('/vpn re')
    await vi.waitFor(() => { expect(visible()).toContain('Reconnect VPN') })
    expect(visible()).not.toContain('View VPN status')
    input('\x1b')
    expect(vi.mocked(controlVpn)).toHaveBeenCalledTimes(calls + 1)
    // Region rotate: a region name routes to the broker region query and reports the picked country.
    vi.mocked(controlVpn).mockResolvedValue({ kind: 'ok', tunnel: 'connected', relay: 'nz-akl-wg-302' })
    screen.submit('/vpn rotate oceania')
    await vi.waitFor(() => { expect(visible()).toContain('VPN rotated (target: oceania); Host HTTPS egress verified. Exit relay: nz-akl-wg-302.') })
    expect(vi.mocked(controlVpn)).toHaveBeenLastCalledWith('rotate', '', expect.any(AbortSignal), 'oceania')
    expect(followup).not.toHaveBeenCalled()
  } finally {
    tui.stop(); await ctx.fiber.dispose()
    // Windows may retain closed Loader file handles briefly during parallel runs.
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
