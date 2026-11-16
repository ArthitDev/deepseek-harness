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
  const terminal: Terminal = { columns: 160, rows: 60, kittyProtocolActive: false,
    start: vi.fn(), stop: vi.fn(), drainInput: async () => {}, write: vi.fn(), moveBy: vi.fn(),
    hideCursor: vi.fn(), showCursor: vi.fn(), clearLine: vi.fn(), clearFromCursor: vi.fn(),
    clearScreen: vi.fn(), setTitle: vi.fn(), setProgress: vi.fn(), setProgramStatus: vi.fn() }
  const tui = new TuiAltScreen(terminal)
  let screen!: ChatScreen
  const followup = vi.fn()
  const visible = (): string => { tui.renderNow(); return stripVTControlCharacters(tui.getScreenLines().join('\n')) }
  try {
    vi.mocked(fetchEgress).mockResolvedValue({ ip: '203.0.113.7', mullvad_exit_ip: true })
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
    await vi.waitFor(() => { expect(visible()).toContain('usage: /vpn [status|reconnect]') })
    await vi.waitFor(() => { expect(ctx.vpnStatus.read().state).toBe('verified') })
    screen.submit('/vpn status')
    await vi.waitFor(() => { expect(visible()).toContain('VPN tunnel: connected (ok)') })
    expect(visible()).toContain('Host HTTPS: verified (mullvad)')
    vi.mocked(fetchEgress).mockRejectedValue(new Error('timeout'))
    screen.submit('/vpn reconnect')
    await vi.waitFor(() => { expect(visible()).toContain('VPN reconnect completed; Host HTTPS unknown. Egress is not confirmed.') })
    expect(visible()).not.toContain('VPN reconnected; Host HTTPS egress verified.')
    expect(ctx.vpnStatus.read().state).toBe('unknown')
    expect(visible().split('\n').filter(line => line.includes('VPN reconnect completed'))
      .map(line => line.split('│')[0]!.trim())).toMatchSnapshot('reconnect without verified egress')
    expect(followup).not.toHaveBeenCalled()
  } finally {
    tui.stop(); await ctx.fiber.dispose()
    // Windows may retain closed Loader file handles briefly during parallel runs.
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
