/** Saved SSH machine registry and strict host-key connection owner. */

import { randomUUID } from 'node:crypto'
import { Context, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { SshConnectionPool, type RemoteMachineProfile } from './connection.ts'
import { SshFileSystem } from './fs.ts'
import { isRemoteMachineId, parseRemoteExecutionPath } from './path.ts'
import { SshSubprocessRuntime } from './subprocess.ts'
import type {
  RemoteMachineIdRequest,
  RemoteMachineProbeRequest,
  RemoteMachineProbeValue,
  RemoteMachineRemoveValue,
  RemoteMachineSaveRequest,
  RemoteMachinesValue,
  RemoteMachineTrustRequest,
  RemoteMachineValue,
  RemoteMachineView,
} from './types.ts'

export type * from './types.ts'
export * from './path.ts'
export { SshConnectionPool } from './connection.ts'
export type { RemoteMachineProfile } from './connection.ts'
export { SshFileSystem } from './fs.ts'
export { SshSubprocessRuntime } from './subprocess.ts'

/** User-settings namespace that stores SSH machine profiles. */
export const SETTINGS_NAMESPACE = 'remote-machines'

interface RemoteMachineSettings {
  machines: Volatile<RemoteMachineProfile[]>
}

const ProfileSchema: z<RemoteMachineProfile> = z.object({
  id: z.string().required(),
  name: z.string().required(),
  host: z.string().required(),
  port: z.number().min(1).max(65_535).default(22),
  username: z.string().required(),
  auth: z.union(['agent', 'password', 'password-prompt', 'private-key'] as const).default('agent'),
  defaultPath: z.string(),
  password: z.string().role('secret'),
  privateKey: z.string().role('secret'),
  passphrase: z.string().role('secret'),
  fingerprint: z.string(),
})

const SettingsSchema = z.object({
  machines: z.array(ProfileSchema).default([]).volatile(),
})

function trimmed(value: string, field: string): string {
  const result = value.trim()
  if (result.length === 0) throw new RemoteError('remote-machine/invalid', `${field} must not be blank`, { field })
  return result
}

function viewOf(profile: RemoteMachineProfile): RemoteMachineView {
  return {
    id: profile.id,
    name: profile.name,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    auth: profile.auth,
    ...(profile.defaultPath === undefined ? {} : { defaultPath: profile.defaultPath }),
    ...(profile.fingerprint === undefined ? {} : { fingerprint: profile.fingerprint }),
    hasPassword: profile.password !== undefined && profile.password.length > 0,
    hasPrivateKey: profile.privateKey !== undefined && profile.privateKey.length > 0,
    hasPassphrase: profile.passphrase !== undefined && profile.passphrase.length > 0,
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    remoteMachines: RemoteMachines
  }
}

/** Owns saved SSH profiles, fingerprint trust, and shared remote transports. */
export class RemoteMachines extends TypertRemoteService {
  static inject = ['settings']
  static Config = SettingsSchema

  private readonly settingsService: Context['settings']
  private readonly entryId: string
  private readonly transientPasswords = new Map<string, {
    host: string
    port: number
    username: string
    password: string
  }>()
  /** Fingerprint-verified connection pool shared by filesystem and subprocess providers. */
  readonly connections: SshConnectionPool

  constructor(ctx: Context, public config: RemoteMachineSettings) {
    super(ctx, 'remoteMachines', { namespace: 'remoteMachines' })
    this.settingsService = ctx.settings
    this.entryId = ctx.fiber.entry?.options.id ?? SETTINGS_NAMESPACE
    this.connections = new SshConnectionPool(id => this.profile(id))
    ctx.effect(() => () => { this.connections.invalidate() }, 'remote-machines: close SSH connections')
    ctx.plugin(SshFileSystem)
    ctx.plugin(SshSubprocessRuntime)
  }

  /**
   * Read a Host-only profile with any lifetime-only password applied.
   * @param id - Saved machine identifier.
   * @returns the complete profile, or undefined when it is absent.
   */
  profile(id: string): RemoteMachineProfile | undefined {
    const profile = this.config.machines.get().find(machine => machine.id === id)
    const transient = this.transientPasswords.get(id)
    return profile?.auth === 'password-prompt'
      && transient?.host === profile.host
      && transient.port === profile.port
      && transient.username === profile.username
      ? { ...profile, password: transient.password }
      : profile
  }

  /**
   * List every saved machine without credential fields.
   * @returns redacted views for every saved machine.
   */
  @Remote('list')
  list(): RemoteMachinesValue {
    return { machines: this.config.machines.get().map(viewOf) }
  }

  /**
   * Create or update one saved profile.
   * @param request - Validated profile fields and optional secrets.
   * @returns the redacted saved profile.
   */
  @Remote('save')
  async save(request: RemoteMachineSaveRequest): Promise<RemoteMachineValue> {
    const id = request.id ?? `machine-${randomUUID()}`
    if (!isRemoteMachineId(id)) throw new RemoteError('remote-machine/invalid', 'invalid machine id', { field: 'id' })
    const machines = this.config.machines.get()
    const previous = machines.find(machine => machine.id === id)
    const profile: RemoteMachineProfile = {
      id,
      name: trimmed(request.name, 'name'),
      host: trimmed(request.host, 'host'),
      port: request.port ?? 22,
      username: trimmed(request.username, 'username'),
      auth: request.auth,
      ...(request.defaultPath === undefined || request.defaultPath.trim().length === 0
        ? {}
        : { defaultPath: request.defaultPath.trim() }),
      ...(request.auth !== 'password'
        ? {}
        : request.password === undefined && previous?.auth === 'password'
          ? previous.password === undefined ? {} : { password: previous.password }
          : request.password === undefined ? {} : { password: request.password }),
      ...(request.auth !== 'private-key'
        ? {}
        : request.privateKey === undefined && previous?.auth === 'private-key'
          ? previous.privateKey === undefined ? {} : { privateKey: previous.privateKey }
          : request.privateKey === undefined ? {} : { privateKey: request.privateKey }),
      ...(request.auth !== 'private-key'
        ? {}
        : request.passphrase === undefined && previous?.auth === 'private-key'
          ? previous.passphrase === undefined ? {} : { passphrase: previous.passphrase }
          : request.passphrase === undefined ? {} : { passphrase: request.passphrase }),
      ...(previous?.fingerprint === undefined
        || previous.host !== request.host.trim()
        || previous.port !== (request.port ?? 22)
        || previous.username !== request.username.trim()
        ? {}
        : { fingerprint: previous.fingerprint }),
    }
    if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65_535) {
      throw new RemoteError('remote-machine/invalid', 'port must be an integer from 1 to 65535', { field: 'port' })
    }
    await this.updateMachines([...machines.filter(machine => machine.id !== id), profile])
    this.transientPasswords.delete(id)
    return { machine: viewOf(profile) }
  }

  /**
   * Delete a saved profile that has no registered workspace.
   * @param request - Saved machine identifier.
   * @returns confirmation after settings and cached credentials are cleared.
   */
  @Remote('remove')
  async remove(request: RemoteMachineIdRequest): Promise<RemoteMachineRemoveValue> {
    this.requireProfile(request.id)
    const workspaces = this.ctx.get('workspaceRegistry') as undefined | { list(): readonly { path: string }[] }
    if (workspaces?.list().some(workspace => parseRemoteExecutionPath(workspace.path)?.machineId === request.id) === true) {
      throw new RemoteError(
        'remote-machine/in-use',
        `remote machine ${JSON.stringify(request.id)} still has registered workspaces`,
        { id: request.id },
      )
    }
    await this.updateMachines(this.config.machines.get().filter(machine => machine.id !== request.id))
    this.transientPasswords.delete(request.id)
    this.connections.invalidate(request.id)
    return { removed: true }
  }

  /**
   * Observe an SSH host key and platform without trusting a new key.
   * @param request - Saved machine identifier and optional lifetime-only password.
   * @returns the observed fingerprint and remote platform details.
   */
  @Remote('probe')
  async probe(request: RemoteMachineProbeRequest): Promise<RemoteMachineProbeValue> {
    const profile = this.requireProfile(request.id)
    if (request.password !== undefined) {
      if (profile.auth !== 'password-prompt') {
        throw new RemoteError('remote-machine/invalid', 'password is only accepted for password-prompt authentication', { field: 'password' })
      }
      if (request.password.length === 0) {
        throw new RemoteError('remote-machine/invalid', 'password must not be empty', { field: 'password' })
      }
      this.transientPasswords.set(request.id, {
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password: request.password,
      })
      this.connections.invalidate(request.id)
    }
    try {
      return await this.connections.probe(request.id)
    } catch (error) {
      throw new RemoteError(
        'remote-machine/unavailable',
        `Could not connect to remote machine ${JSON.stringify(request.id)}: ${error instanceof Error ? error.message : String(error)}`,
        { id: request.id },
        { cause: error },
      )
    }
  }

  /**
   * Re-probe and save one exact SSH host fingerprint.
   * @param request - Saved machine identifier and observed fingerprint.
   * @returns the updated redacted profile.
   */
  @Remote('trust')
  async trust(request: RemoteMachineTrustRequest): Promise<RemoteMachineValue> {
    const current = this.requireStoredProfile(request.id)
    const fingerprint = trimmed(request.fingerprint, 'fingerprint')
    const observed = await this.probe({ id: request.id })
    if (observed.fingerprint !== fingerprint) {
      throw new RemoteError(
        'remote-machine/fingerprint-mismatch',
        `Remote host fingerprint changed for ${JSON.stringify(request.id)}`,
        { id: request.id, expected: fingerprint, actual: observed.fingerprint },
      )
    }
    const profile = { ...current, fingerprint }
    await this.updateMachines(
      this.config.machines.get().map(machine => machine.id === request.id ? profile : machine),
    )
    this.connections.invalidate(request.id)
    return { machine: viewOf(profile) }
  }

  private requireProfile(id: string): RemoteMachineProfile {
    const profile = this.profile(id)
    if (profile === undefined) throw new RemoteError('remote-machine/not-found', `remote machine ${JSON.stringify(id)} was not found`, { id })
    return profile
  }

  private requireStoredProfile(id: string): RemoteMachineProfile {
    const profile = this.config.machines.get().find(machine => machine.id === id)
    if (profile === undefined) throw new RemoteError('remote-machine/not-found', `remote machine ${JSON.stringify(id)} was not found`, { id })
    return profile
  }

  private async updateMachines(machines: RemoteMachineProfile[]): Promise<void> {
    await this.settingsService.update(this.entryId, { machines })
    this.connections.invalidate()
  }
}

export default RemoteMachines
