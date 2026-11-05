/** Browser-safe vocabulary for saved SSH machines. Secret fields only exist on write requests. */

export type RemoteMachineAuth = 'agent' | 'password' | 'password-prompt' | 'private-key'

/** Redacted saved machine fields returned to browser clients. */
export interface RemoteMachineView {
  readonly id: string
  readonly name: string
  readonly host: string
  readonly port: number
  readonly username: string
  readonly auth: RemoteMachineAuth
  readonly defaultPath?: string
  readonly fingerprint?: string
  readonly hasPassword: boolean
  readonly hasPrivateKey: boolean
  readonly hasPassphrase: boolean
}

/** List response for every saved machine. */
export interface RemoteMachinesValue {
  readonly machines: readonly RemoteMachineView[]
}

/** Fields accepted when creating or updating a saved machine. */
export interface RemoteMachineSaveRequest {
  readonly id?: string
  readonly name: string
  readonly host: string
  readonly port?: number
  readonly username: string
  readonly auth: RemoteMachineAuth
  readonly defaultPath?: string
  readonly password?: string
  readonly privateKey?: string
  readonly passphrase?: string
}

/** Single-machine mutation response. */
export interface RemoteMachineValue {
  readonly machine: RemoteMachineView
}

/** Identifies one saved machine. */
export interface RemoteMachineIdRequest {
  readonly id: string
}

/** Probe request with an optional lifetime-only password. */
export interface RemoteMachineProbeRequest extends RemoteMachineIdRequest {
  readonly password?: string
}

/** Confirms that a saved machine was removed. */
export interface RemoteMachineRemoveValue {
  readonly removed: true
}

/** Host-key and platform facts observed during an SSH probe. */
export interface RemoteMachineProbeValue {
  readonly fingerprint: string
  readonly trusted: boolean
  readonly home?: string
  readonly platform?: 'linux' | 'darwin' | 'windows' | 'unknown'
}

/** Fingerprint confirmation for one saved machine. */
export interface RemoteMachineTrustRequest {
  readonly id: string
  readonly fingerprint: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'remote-machine/not-found': { readonly id: string }
    'remote-machine/in-use': { readonly id: string }
    'remote-machine/invalid': { readonly field: string }
    'remote-machine/auth-failed': { readonly id: string }
    'remote-machine/fingerprint-required': { readonly id: string; readonly fingerprint: string }
    'remote-machine/fingerprint-mismatch': { readonly id: string; readonly expected: string; readonly actual: string }
    'remote-machine/unavailable': { readonly id: string }
  }
}
