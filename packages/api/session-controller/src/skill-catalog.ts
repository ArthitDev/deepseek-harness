/** Session-addressed catalog plus user-global skill management Remotes. */

import { cp, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import { isUserInvocable } from '@deepseek-ai/dsh-skill'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  InstalledSkillsValue,
  SkillInstallRequest,
  SkillInstallValue,
  SkillListRequest,
  SkillListValue,
  SkillSearchEntry,
  SkillSearchRequest,
  SkillSearchValue,
  SkillRemoveRequest,
  SkillRemoveValue,
  SkillSetEnabledRequest,
  SkillSetEnabledValue,
  SkillTerminalCloseRequest,
  SkillTerminalCloseValue,
  SkillTerminalOpenRequest,
  SkillTerminalOpenValue,
  SkillTerminalReadRequest,
  SkillTerminalReadValue,
  SkillTerminalWriteRequest,
  SkillTerminalWriteValue,
} from './types.ts'

const CLI_OUTPUT_LIMIT = 128 * 1024
const CLI_TIMEOUT_MS = 120_000
const TERMINAL_OUTPUT_LIMIT = 512 * 1024
const TERMINAL_INPUT_LIMIT = 16 * 1024
const SKILL_NAME = /^[a-z0-9][a-z0-9._-]*$/
const SEARCH_RESULT = /\b([a-z0-9_.-]+\/[a-z0-9_.-]+@([a-z0-9_.-]+))\b/gi
const ANSI_ESCAPE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g

/** Replaceable process runner and home path for focused tests. */
export interface SessionSkillCatalogInternals {
  readonly dshHome?: string
  readonly runCli?: (args: readonly string[], cwd: string, signal: AbortSignal) => Promise<string>
}

interface SkillTerminalState {
  readonly handle: SubprocessTerminalHandle
  output: string
  baseOffset: number
  done: boolean
  outputEnded: boolean
  exitCode?: number | null
  error?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the Session-addressed `skills` Remote namespace. */
    sessionSkillCatalog: SessionSkillCatalog
  }
}

/** Host service backing `ctx.remote.skills` without activating a cold Agent. */
export class SessionSkillCatalog extends TypertRemoteService {
  static inject = ['agents', 'sessionQuery', 'typert']

  private readonly dshHome: string
  private readonly runCli: (args: readonly string[], cwd: string, signal: AbortSignal) => Promise<string>
  private installing = false
  private readonly terminals = new Map<string, SkillTerminalState>()

  /**
   * @param ctx - Host context carrying Session reads and optional skill/preset services.
   * @param internals - test replacements for the DSH home and skills.sh CLI process.
   */
  constructor(ctx: Context, internals: SessionSkillCatalogInternals = {}) {
    super(ctx, 'sessionSkillCatalog', { namespace: 'skills' })
    this.dshHome = internals.dshHome ?? resolveDshHome()
    this.runCli = internals.runCli ?? ((args, cwd, signal) => this.executeCli(args, cwd, signal))
    ctx.effect(() => async () => {
      const terminals = [...this.terminals.values()]
      this.terminals.clear()
      await Promise.allSettled(terminals.map(terminal => terminal.handle.terminate()))
    }, 'session skill catalog: interactive terminal cleanup')
  }

  /**
   * Start one unrestricted command in the host platform's native interactive shell.
   * @param request - Command and initial terminal dimensions.
   * @param signal - Caller cancellation for terminal startup.
   * @returns the caller-owned terminal identifier.
   */
  @Remote
  async terminalOpen(request: SkillTerminalOpenRequest, signal: AbortSignal): Promise<SkillTerminalOpenValue> {
    const command = request.command.trim()
    if (command.length === 0 || command.length > TERMINAL_INPUT_LIMIT) {
      throw new RemoteError('gateway/bad-request', 'terminal command must contain 1 to 16384 characters', {})
    }
    if (this.terminals.size >= 4) {
      throw new RemoteError('gateway/internal', 'too many Skills settings terminals are open', {})
    }
    const rows = request.rows ?? 24
    const cols = request.cols ?? 100
    if (!Number.isInteger(rows) || rows < 2 || rows > 200
      || !Number.isInteger(cols) || cols < 20 || cols > 400) {
      throw new RemoteError('gateway/bad-request', 'terminal dimensions are invalid', {})
    }
    const subprocess = this.ctx.get('subprocess')
    if (subprocess === undefined) throw new RemoteError('gateway/internal', 'subprocess service is unavailable', {})
    const declaredShell = process.platform === 'win32'
      ? process.env.ComSpec ?? 'cmd.exe'
      : process.env.SHELL ?? '/bin/sh'
    try {
      const shell = await subprocess.resolveExecutable(declaredShell, undefined, signal)
      const handle = await subprocess.spawnTerminal({
        argv: [shell], cwd: homedir(), rows, cols, graceMs: 2_000, signal,
        env: { NO_COLOR: '1', DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' },
      })
      const id = randomUUID()
      const state: SkillTerminalState = {
        handle, output: '', baseOffset: 0, done: false, outputEnded: false,
      }
      this.terminals.set(id, state)
      handle.output.setEncoding('utf8')
      handle.output.on('data', (chunk: string) => {
        state.output += chunk
        if (state.output.length <= TERMINAL_OUTPUT_LIMIT) return
        const removed = state.output.length - TERMINAL_OUTPUT_LIMIT
        state.output = state.output.slice(removed)
        state.baseOffset += removed
      })
      handle.output.once('end', () => { state.outputEnded = true })
      handle.output.once('error', (error) => {
        state.error = String(error)
        state.outputEnded = true
      })
      void handle.done.then(
        (outcome) => {
          state.done = true
          state.exitCode = outcome.exitCode
        },
        (error: unknown) => {
          state.done = true
          state.outputEnded = true
          state.error = String(error)
        },
      )
      try {
        await handle.write(`${command}\r`)
      } catch (error) {
        this.terminals.delete(id)
        await handle.terminate()
        throw error
      }
      return { id }
    } catch (error: unknown) {
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/internal', `terminal could not start: ${String(error)}`, {})
    }
  }

  /**
   * Read terminal output from the caller-owned character offset.
   * @param request - Terminal identifier and character offset.
   * @returns retained output and the next readable offset.
   */
  @Remote
  terminalRead(request: SkillTerminalReadRequest): SkillTerminalReadValue {
    const state = this.terminal(request.id)
    if (!Number.isInteger(request.offset) || request.offset < 0) {
      throw new RemoteError('gateway/bad-request', 'terminal output offset is invalid', {})
    }
    const lossy = request.offset < state.baseOffset
    const start = lossy ? 0 : Math.min(request.offset - state.baseOffset, state.output.length)
    return {
      text: state.output.slice(start),
      nextOffset: state.baseOffset + state.output.length,
      lossy,
      exited: state.done && state.outputEnded,
      ...state.exitCode === undefined ? {} : { exitCode: state.exitCode },
      ...state.error === undefined ? {} : { error: state.error },
    }
  }

  /**
   * Write terminal input verbatim, including control characters.
   * @param request - Terminal identifier and input text.
   * @returns whether the terminal accepted the input.
   */
  @Remote
  async terminalWrite(request: SkillTerminalWriteRequest): Promise<SkillTerminalWriteValue> {
    if (request.text.length > TERMINAL_INPUT_LIMIT) {
      throw new RemoteError('gateway/bad-request', 'terminal input is too long', {})
    }
    const state = this.terminal(request.id)
    if (state.done) throw new RemoteError('gateway/bad-request', 'terminal has exited', {})
    try {
      await state.handle.write(request.text)
      return { accepted: true }
    } catch (error: unknown) {
      throw new RemoteError('gateway/internal', `terminal input failed: ${String(error)}`, {})
    }
  }

  /**
   * Terminate and forget one Skills settings terminal.
   * @param request - Terminal identifier to close.
   * @returns whether an open terminal was closed.
   */
  @Remote
  async terminalClose(request: SkillTerminalCloseRequest): Promise<SkillTerminalCloseValue> {
    const state = this.terminals.get(request.id)
    if (state === undefined) return { closed: false }
    this.terminals.delete(request.id)
    try {
      await state.handle.terminate()
      return { closed: true }
    } catch (error: unknown) {
      throw new RemoteError('gateway/internal', `terminal cleanup failed: ${String(error)}`, {})
    }
  }

  private terminal(id: string): SkillTerminalState {
    const terminal = this.terminals.get(id)
    if (terminal === undefined) throw new RemoteError('gateway/bad-request', 'terminal was not found', {})
    return terminal
  }

  /**
   * List skills installed directly in the user-global DSH skill root.
   * @returns the installed skill names in stable order.
   */
  @Remote
  async installed(): Promise<InstalledSkillsValue> {
    try {
      const enabled = await this.installedAt(join(this.dshHome, 'skills'))
      const disabled = await this.installedAt(join(this.dshHome, 'disabled-skills'))
      const skills = new Map(disabled.map(name => [name, false]))
      for (const name of enabled) skills.set(name, true)
      return { skills: [...skills].sort(([a], [b]) => a.localeCompare(b)).map(([name, active]) => ({ name, enabled: active })) }
    } catch (error: unknown) {
      throw new RemoteError('gateway/internal', `installed skill listing failed: ${String(error)}`, {})
    }
  }

  /**
   * Enable or disable one global skill by moving it into or out of discovery.
   * @param request - Installed skill name and desired state.
   * @returns the persisted state.
   */
  @Remote
  async setEnabled(request: SkillSetEnabledRequest): Promise<SkillSetEnabledValue> {
    const name = request.name.trim()
    if (name !== request.name || !SKILL_NAME.test(name) || typeof request.enabled !== 'boolean') {
      throw new RemoteError('gateway/bad-request', 'installed skill state is invalid', {})
    }
    const sourceRoot = join(this.dshHome, request.enabled ? 'disabled-skills' : 'skills')
    const targetRoot = join(this.dshHome, request.enabled ? 'skills' : 'disabled-skills')
    const source = join(sourceRoot, name)
    const target = join(targetRoot, name)
    const [sourceExists, targetExists] = await Promise.all([
      this.isInstalledSkill(source),
      this.isInstalledSkill(target),
    ])
    if (!sourceExists) {
      if (targetExists) return { name, enabled: request.enabled }
      throw new RemoteError('gateway/bad-request', `skill "${name}" is not installed`, {})
    }
    if (targetExists) {
      throw new RemoteError('gateway/internal', `skill "${name}" exists in both enabled and disabled directories`, {})
    }
    try {
      await mkdir(targetRoot, { recursive: true })
      await rename(source, target)
      return { name, enabled: request.enabled }
    } catch (error: unknown) {
      throw new RemoteError('gateway/internal', `skill "${name}" could not be ${request.enabled ? 'enabled' : 'disabled'}: ${String(error)}`, {})
    }
  }

  /**
   * Remove one global skill from discovery while retaining a recoverable backup.
   * @param request - Installed skill name to remove.
   * @returns whether an installed directory was moved to backup.
   */
  @Remote
  async remove(request: SkillRemoveRequest): Promise<SkillRemoveValue> {
    const name = request.name.trim()
    if (name !== request.name || !SKILL_NAME.test(name)) {
      throw new RemoteError('gateway/bad-request', 'installed skill name is invalid', {})
    }
    const enabled = join(this.dshHome, 'skills', name)
    const disabled = join(this.dshHome, 'disabled-skills', name)
    const [enabledExists, disabledExists] = await Promise.all([
      this.isInstalledSkill(enabled),
      this.isInstalledSkill(disabled),
    ])
    if (enabledExists && disabledExists) {
      throw new RemoteError('gateway/internal', `skill "${name}" exists in both enabled and disabled directories`, {})
    }
    const source = enabledExists ? enabled : disabledExists ? disabled : undefined
    if (source === undefined) return { name, removed: false }
    const backupRoot = join(
      this.dshHome,
      'skill-backups',
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`,
    )
    try {
      await mkdir(backupRoot, { recursive: true })
      await rename(source, join(backupRoot, name))
      return { name, removed: true }
    } catch (error: unknown) {
      throw new RemoteError('gateway/internal', `skill "${name}" could not be removed: ${String(error)}`, {})
    }
  }

  private async installedAt(root: string): Promise<string[]> {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const names = await Promise.all(entries.filter(entry => SKILL_NAME.test(entry.name)).map(async entry => (
      await this.isInstalledSkill(join(root, entry.name)) ? entry.name : undefined
    )))
    return names.filter((name): name is string => name !== undefined)
  }

  private async isInstalledSkill(path: string): Promise<boolean> {
    try {
      return (await stat(join(path, 'SKILL.md'))).isFile()
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  /**
   * Search skills.sh through the maintained `skills` CLI.
   * @param request - validated search text.
   * @param signal - caller cancellation.
   * @returns matching installable skills.
   */
  @Remote
  async search(request: SkillSearchRequest, signal: AbortSignal): Promise<SkillSearchValue> {
    const query = request.query.trim()
    if (query.length === 0 || query.length > 100) {
      throw new RemoteError('gateway/bad-request', 'skill search query must contain 1 to 100 characters', {})
    }
    let output: string
    try {
      output = await this.runCli(['--yes', 'skills', 'find', query], this.dshHome, signal)
    } catch (error: unknown) {
      throw new RemoteError('gateway/internal', `skills.sh search failed: ${String(error)}`, {})
    }
    return { skills: parseSearchOutput(output) }
  }

  /**
   * Install one skills.sh source into the user-global DSH skill root.
   * @param request - canonical owner/repository and skill selection.
   * @param signal - caller cancellation.
   * @returns the installed skill identity.
   */
  @Remote('add')
  async install(request: SkillInstallRequest, signal: AbortSignal): Promise<SkillInstallValue> {
    const source = request.source.trim()
    if (!validInstallSource(source)) {
      throw new RemoteError('gateway/bad-request', 'skill source must be owner/repository@skill', {})
    }
    if (this.installing) throw new RemoteError('gateway/internal', 'another skill installation is already running', {})
    this.installing = true
    let staging: string | undefined
    try {
      staging = await mkdtemp(join(tmpdir(), 'dsh-skill-install-'))
      await this.runCli([
        '--yes', 'skills', 'add', source,
        '--agent', 'universal', '-y', '--copy',
      ], staging, signal)
      return await this.publishStagedSkill(
        join(staging, '.agents', 'skills'),
        source.slice(source.lastIndexOf('@') + 1),
      )
    } catch (error: unknown) {
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/internal', `skill installation failed: ${String(error)}`, {})
    } finally {
      this.installing = false
      if (staging !== undefined) {
        try {
          await rm(staging, { recursive: true, force: true })
        } catch (error: unknown) {
          this.ctx.logger.warn(`skill installer could not remove staging directory: ${String(error)}`)
        }
      }
    }
  }

  /**
   * List the user-invocable skills visible to one Session composition.
   * @param request - Session identity whose cwd and preset select the catalog view.
   * @param signal - caller lifetime carried by the Remote transport; admitted catalog reads retain their existing completion semantics.
   * @returns user-invocable skill metadata without loading skill bodies.
   * @throws RemoteError when the Session cannot be inspected or no registry can serve it.
   */
  @Remote
  async list(request: SkillListRequest, signal: AbortSignal): Promise<SkillListValue> {
    void signal
    const { sessionId } = request
    let cwd: string | undefined
    let agentPreset: string | undefined
    try {
      using observation = await this.ctx.sessionQuery.observeSession(sessionId)
      if (observation.projections === undefined) {
        throw new Error('skill catalog requires a projected Session observation')
      }
      cwd = observation.header.cwd
      agentPreset = observation.projections.values.agentPreset ?? undefined
    } catch (error: unknown) {
      if (error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
      }
      throw new RemoteError(
        'gateway/internal',
        `session "${sessionId}" could not be inspected: ${String(error)}`,
        {},
      )
    }
    if (cwd === undefined) {
      throw new RemoteError('gateway/internal', `session "${sessionId}" has no project cwd`, {})
    }

    const live = this.ctx.agents.get(sessionId)
    const presets = this.ctx.get('agentPresets')
    const scoped = live === undefined ? undefined : presets?.serviceFor(live, 'skills')
    const skillRegistry = scoped ?? this.ctx.get('skills')
    if (skillRegistry === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'skill registry is absent: neither this session\'s agent preset nor the host composition mounts @deepseek-ai/dsh-skill',
        {},
      )
    }

    const scope = await this.scopeFor(sessionId, agentPreset)
    try {
      const skills = (await skillRegistry.list({ cwd, scope })).filter(isUserInvocable)
      return {
        skills: skills.map(skill => ({
          name: skill.name,
          ...skill.path === undefined ? {} : { path: skill.path },
          description: skill.description,
          ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
          modelInvocable: skill.invocation.modelInvocable,
        })),
      }
    } catch (error: unknown) {
      throw new RemoteError('gateway/internal', `skill listing failed: ${String(error)}`, {})
    }
  }

  /** Resolve a live or standing preset scope without creating an Agent. */
  private async scopeFor(
    sessionId: SessionId,
    agentPreset: string | undefined,
  ): Promise<ScopeKey | undefined> {
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) return live
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return undefined
    try {
      return await presets.standingKeyFor(agentPreset)
    } catch {
      // An unknown or unusable recorded preset falls back to the global registry.
      return undefined
    }
  }

  /** Run one shell-free npx invocation with bounded output and no Harness credentials. */
  private async executeCli(args: readonly string[], cwd: string, signal: AbortSignal): Promise<string> {
    const subprocess = this.ctx.get('subprocess')
    if (subprocess === undefined) throw new Error('subprocess service is unavailable')
    const deadline = AbortSignal.timeout(CLI_TIMEOUT_MS)
    const combined = AbortSignal.any([signal, deadline])
    const executable = await subprocess.resolveExecutable('npx', undefined, combined)
    const handle = subprocess.spawn({
      argv: [executable, ...args],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: CLI_OUTPUT_LIMIT },
        stderr: { maxBytes: CLI_OUTPUT_LIMIT },
      },
      env: { DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' },
      graceMs: 2_000,
      signal: combined,
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text.trim() ?? ''
    if (combined.aborted) throw new Error(deadline.aborted ? 'skills CLI timed out' : 'skills CLI was cancelled')
    if (outcome.exitCode !== 0) throw new Error(stderr || `skills CLI exited with code ${String(outcome.exitCode)}`)
    return stdout
  }

  /** Publish the requested staged directory with a recoverable backup when replacing it. */
  private async publishStagedSkill(stagedRoot: string, expectedName: string): Promise<SkillInstallValue> {
    let entries
    try {
      entries = await readdir(stagedRoot, { withFileTypes: true })
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error('skills CLI completed without producing a DSH-compatible skill')
      }
      throw error
    }
    const skills = entries.filter(entry => entry.isDirectory() && SKILL_NAME.test(entry.name))
    const skill = skills.find(entry => entry.name.toLowerCase() === expectedName.toLowerCase())
    if (skill === undefined || skills.length !== 1) {
      throw new Error(`skills CLI did not produce exactly the requested skill "${expectedName}"`)
    }

    const targetRoot = join(this.dshHome, 'skills')
    const backupRoot = join(
      this.dshHome,
      'skill-backups',
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`,
    )
    await mkdir(targetRoot, { recursive: true })
    const name = basename(skill.name)
    const source = join(stagedRoot, name)
    const pending = join(targetRoot, `.install-${name}-${randomUUID()}`)
    const target = join(targetRoot, name)
    const disabledTarget = join(this.dshHome, 'disabled-skills', name)
    const backup = join(backupRoot, name)
    const skillFile = await stat(join(source, 'SKILL.md'))
    if (!skillFile.isFile()) throw new Error(`installed skill "${name}" has no SKILL.md`)
    await cp(source, pending, { recursive: true })
    const [targetExists, disabledExists] = await Promise.all([
      this.isInstalledSkill(target),
      this.isInstalledSkill(disabledTarget),
    ])
    if (targetExists && disabledExists) throw new Error(`skill "${name}" exists in both enabled and disabled directories`)
    const replaced = targetExists ? target : disabledExists ? disabledTarget : undefined
    if (replaced !== undefined) {
      await mkdir(backupRoot, { recursive: true })
      await rename(replaced, backup)
    }
    try {
      await rename(pending, target)
    } catch (error) {
      await rm(pending, { recursive: true, force: true })
      if (replaced !== undefined) await rename(backup, replaced)
      throw error
    }
    return { installed: [name], backedUp: replaced === undefined ? [] : [name] }
  }
}

/**
 * Parse stable owner/repository@skill identifiers from CLI presentation output.
 * @param output - Raw skills CLI presentation output.
 * @returns unique catalog entries in presentation order.
 */
export function parseSearchOutput(output: string): SkillSearchEntry[] {
  const plain = output.replace(ANSI_ESCAPE, '')
  const results = new Map<string, SkillSearchEntry>()
  for (const match of plain.matchAll(SEARCH_RESULT)) {
    const source = match[1]
    const name = match[2]
    if (source === undefined || name === undefined || results.has(source)) continue
    results.set(source, { source, name, url: `https://skills.sh/${source.replace('@', '/')}` })
  }
  return [...results.values()]
}

/** Accept only one exact CLI catalog identifier. */
function validInstallSource(source: string): boolean {
  const part = '[a-z0-9][a-z0-9_.-]*'
  return new RegExp(`^${part}\\/${part}@${part}$`, 'i').test(source)
}

export default SessionSkillCatalog
