import type { Context } from '@deepseek-ai/cordis'
import type {
  RemoteMachineProbeValue, RemoteMachineSaveRequest, RemoteMachineView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Observable state for saved remote machines. */
export interface RemoteMachineSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error'
  machines: readonly RemoteMachineView[]
  error: string | null
}

/** Coordinates remote-machine RPCs and publishes their browser state. */
export class RemoteMachineController {
  /** Mutable snapshot source consumed by the settings and workspace views. */
  readonly store = createSnapshotStore<RemoteMachineSnapshot>({
    status: 'idle',
    machines: [],
    error: null,
  })

  constructor(private readonly ctx: Context) {}

  private namespace(): Context['remote']['remoteMachines'] {
    return this.ctx.remote.remoteMachines
  }

  /** Load the redacted machine list, or an empty list when the Host service is absent. */
  async load(): Promise<void> {
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    const result = await this.namespace().list()
    if (!result.ok) {
      if (result.error.code === 'gateway/invocation-unavailable') {
        this.store.set({ status: 'ready', machines: [], error: null })
        return
      }
      this.store.update((state) => { state.status = 'error'; state.error = result.error.message })
      return
    }
    this.store.set({ status: 'ready', machines: result.value.machines, error: null })
  }

  /**
   * Save one machine profile and update the local snapshot.
   * @param request - Machine fields and optional credentials accepted by the Host.
   * @returns the redacted saved profile.
   */
  async save(request: RemoteMachineSaveRequest): Promise<RemoteMachineView> {
    const result = await this.namespace().save(request)
    if (!result.ok) throw new Error(result.error.message)
    this.store.update((state) => {
      state.status = 'ready'
      state.error = null
      state.machines = [
        ...state.machines.filter(machine => machine.id !== result.value.machine.id),
        result.value.machine,
      ]
    })
    return result.value.machine
  }

  /**
   * Remove one saved machine from the Host and local snapshot.
   * @param id - Saved machine identifier.
   * @returns when both states no longer contain the machine.
   */
  async remove(id: string): Promise<void> {
    const result = await this.namespace().remove({ id })
    if (!result.ok) throw new Error(result.error.message)
    this.store.update((state) => {
      state.machines = state.machines.filter(machine => machine.id !== id)
    })
  }

  /**
   * Probe one SSH endpoint without trusting its host key.
   * @param id - Saved machine identifier.
   * @param password - Lifetime-only password for prompt authentication.
   * @returns the observed fingerprint and remote platform details.
   */
  async probe(id: string, password?: string): Promise<RemoteMachineProbeValue> {
    const result = await this.namespace().probe({ id, ...(password === undefined ? {} : { password }) })
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  /**
   * Trust an observed fingerprint after the Host verifies it again.
   * @param id - Saved machine identifier.
   * @param fingerprint - Exact fingerprint shown by the probe.
   * @returns the updated redacted profile.
   */
  async trust(id: string, fingerprint: string): Promise<RemoteMachineView> {
    const result = await this.namespace().trust({ id, fingerprint })
    if (!result.ok) throw new Error(result.error.message)
    this.store.update((state) => {
      state.machines = state.machines.map(machine => machine.id === id ? result.value.machine : machine)
    })
    return result.value.machine
  }
}
