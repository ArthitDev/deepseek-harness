import type { Client, ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2'
import type { RemoteMachineAuth, RemoteMachineProbeValue } from './types.ts'

/** Complete saved SSH profile used only by the Host. */
export interface RemoteMachineProfile {
  readonly id: string
  readonly name: string
  readonly host: string
  readonly port: number
  readonly username: string
  readonly auth: RemoteMachineAuth
  readonly defaultPath?: string
  readonly password?: string
  readonly privateKey?: string
  readonly passphrase?: string
  readonly fingerprint?: string
}

interface ConnectedClient {
  readonly client: Client
  readonly fingerprint: string
}

function authentication(profile: RemoteMachineProfile): Partial<ConnectConfig> {
  if (profile.auth === 'agent') {
    const agent = process.env.SSH_AUTH_SOCK
    if (agent !== undefined && agent.length > 0) return { agent }
    return {}
  }
  if (profile.auth === 'password' || profile.auth === 'password-prompt') {
    if (profile.password === undefined || profile.password.length === 0) throw new Error('SSH password is not configured')
    return { password: profile.password }
  }
  if (profile.privateKey === undefined || profile.privateKey.length === 0) throw new Error('SSH private key is not configured')
  return {
    privateKey: profile.privateKey,
    ...(profile.passphrase === undefined || profile.passphrase.length === 0 ? {} : { passphrase: profile.passphrase }),
  }
}

async function openClient(profile: RemoteMachineProfile, trustUnknown: boolean): Promise<ConnectedClient> {
  const { Client } = await import('ssh2')
  return new Promise((resolve, reject) => {
    const client = new Client()
    let observed = ''
    let settled = false
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      client.end()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    client.once('ready', () => {
      if (settled) return
      settled = true
      resolve({ client, fingerprint: observed })
    })
    client.once('error', fail)
    try {
      client.connect({
        host: profile.host,
        port: profile.port,
        username: profile.username,
        readyTimeout: 12_000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
        hostHash: 'sha256',
        hostVerifier: (hash: string) => {
          observed = `SHA256:${hash}`
          return trustUnknown || profile.fingerprint === observed
        },
        ...authentication(profile),
      })
    } catch (error) {
      fail(error)
    }
  })
}

function execText(client: Client, command: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, channel) => {
      if (error !== undefined) {
        reject(error)
        return
      }
      let stdout = ''
      let stderr = ''
      let code: number | null = null
      channel.setEncoding('utf8')
      channel.stderr.setEncoding('utf8')
      channel.on('data', (chunk: Buffer | string) => { stdout += String(chunk) })
      channel.stderr.on('data', (chunk: Buffer | string) => { stderr += String(chunk) })
      channel.once('exit', (value) => { code = typeof value === 'number' ? value : null })
      channel.once('close', () => { resolve({ stdout, stderr, code }) })
      channel.once('error', reject)
    })
  })
}

/** Reuses fingerprint-verified SSH clients for filesystem and process operations. */
export class SshConnectionPool {
  private readonly clients = new Map<string, Promise<Client>>()

  constructor(private readonly profileOf: (id: string) => RemoteMachineProfile | undefined) {}

  /**
   * Connect without accepting the host key and report the observed endpoint facts.
   * @param id - Saved machine identifier.
   * @returns the observed host fingerprint, trust state, home, and platform.
   */
  async probe(id: string): Promise<RemoteMachineProbeValue> {
    const profile = this.requireProfile(id)
    const connected = await openClient(profile, true)
    try {
      const probe = await execText(
        connected.client,
        'printf "home=%s\\n" "$HOME"; (uname -s 2>/dev/null || printf unknown)',
      )
      const lines = probe.stdout.trim().split(/\r?\n/u)
      const homeLine = lines.find(line => line.startsWith('home='))
      const os = lines.at(-1)?.trim().toLowerCase()
      const platform = os === 'linux' ? 'linux' : os === 'darwin' ? 'darwin' : os?.includes('windows') === true ? 'windows' : 'unknown'
      return {
        fingerprint: connected.fingerprint,
        trusted: profile.fingerprint === connected.fingerprint,
        ...(homeLine === undefined ? {} : { home: homeLine.slice(5) }),
        platform,
      }
    } finally {
      connected.client.end()
    }
  }

  /**
   * Get or open a fingerprint-verified SSH client.
   * @param id - Saved machine identifier.
   * @returns a shared live SSH client.
   */
  async client(id: string): Promise<Client> {
    const current = this.clients.get(id)
    if (current !== undefined) return await current
    const profile = this.requireProfile(id)
    if (profile.fingerprint === undefined) throw new Error(`remote machine ${JSON.stringify(id)} has no trusted host fingerprint`)
    const opening = openClient(profile, false).then(({ client }) => {
      const release = (): void => {
        if (this.clients.get(id) === opening) this.clients.delete(id)
      }
      client.once('close', release)
      client.once('end', release)
      client.once('error', release)
      return client
    }, (error: unknown) => {
      this.clients.delete(id)
      throw error
    })
    this.clients.set(id, opening)
    return await opening
  }

  /**
   * Open an SFTP channel on a verified client.
   * @param id - Saved machine identifier.
   * @returns a caller-owned SFTP channel.
   */
  async sftp(id: string): Promise<SFTPWrapper> {
    const client = await this.client(id)
    return await new Promise<SFTPWrapper>((resolve, reject) => client.sftp((error, sftp) => {
      if (error !== undefined) reject(error)
      else resolve(sftp)
    }))
  }

  /**
   * Open a command channel on a verified client.
   * @param id - Saved machine identifier.
   * @param command - Remote shell command.
   * @param options - ssh2 channel options.
   * @returns a caller-owned SSH command channel.
   */
  async exec(id: string, command: string, options: object = {}): Promise<ClientChannel> {
    const client = await this.client(id)
    return await new Promise<ClientChannel>((resolve, reject) => client.exec(command, options, (error, channel) => {
      if (error !== undefined) reject(error)
      else resolve(channel)
    }))
  }

  /**
   * Close cached clients for one machine or the whole pool.
   * @param id - Optional saved machine identifier.
   */
  invalidate(id?: string): void {
    if (id !== undefined) {
      void this.clients.get(id)?.then(client => client.end(), () => {})
      this.clients.delete(id)
      return
    }
    for (const client of this.clients.values()) void client.then(value => value.end(), () => {})
    this.clients.clear()
  }

  private requireProfile(id: string): RemoteMachineProfile {
    const profile = this.profileOf(id)
    if (profile === undefined) throw new Error(`remote machine ${JSON.stringify(id)} was not found`)
    return profile
  }
}
