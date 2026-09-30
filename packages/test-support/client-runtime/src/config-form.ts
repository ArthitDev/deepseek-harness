/** Test doubles for settings transport. */
import { vi } from 'vitest'
import type {
  ConfigForm, ConfigFormSnapshot,
} from '@deepseek-ai/dsh-client-ui-settings/client'

/** Handle over one stubbed scope: the scope, its write spy, and publication controls. */
export interface StubConfigForm<T> {
  /** The scope face handed to the service under test. */
  scope: ConfigForm<T>
  /** Spy behind `scope.set`; resolves immediately. */
  set: ReturnType<typeof vi.fn>
  /** Spy behind `scope.mutate`; resolves immediately. */
  mutate: ReturnType<typeof vi.fn<ConfigForm<T>['mutate']>>
  /** Spy behind `scope.unset`; resolves immediately. */
  unset: ReturnType<typeof vi.fn>
  /** @returns how many listeners are currently subscribed (disposal assertions). */
  listenerCount(): number
  /**
   * Replace part of the snapshot and notify subscribers, as a Host
   * acceptance would.
   * @param next - snapshot fields to replace.
   */
  publish(next: Partial<ConfigFormSnapshot<T>>): void
}

/**
 * Build an in-memory settings scope for service specs: starts in the host
 * loading state, records writes, and lets the test publish Host acceptances.
 * @returns the stub handle.
 */
export function stubConfigForm<T>(): StubConfigForm<T> {
  let snapshot: ConfigFormSnapshot<T> = {
    status: 'loading', value: undefined, base: undefined, user: undefined,
    revision: undefined, writable: false, mode: 'host',
  }
  const listeners = new Set<() => void>()
  const set = vi.fn(() => Promise.resolve(true))
  const mutate = vi.fn<ConfigForm<T>['mutate']>(() => Promise.resolve(true))
  const unset = vi.fn(() => Promise.resolve(true))
  return {
    scope: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      mutate,
      set,
      unset,
    },
    set,
    mutate,
    unset,
    listenerCount: () => listeners.size,
    publish: (next) => {
      snapshot = { ...snapshot, ...next }
      for (const listener of [...listeners]) listener()
    },
  }
}

/** Handle over one stubbed configuration-forms registry: scopes by namespace plus the serving control. */
export interface StubConfigForms {
  /** The registry face handed to the plugin under test. */
  registry: {
    get: <T>(namespace: string) => ConfigForm<T>
    whileServed: (namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void) => () => void
  }
  /** Scopes handed out per namespace, keyed by namespace. */
  scopes: Map<string, StubConfigForm<unknown>>
  /** Mark namespaces as served, running every waiting registration. */
  serve: (namespaces: readonly string[]) => void
}

/**
 * Build an in-memory configuration-forms registry for plugin specs.
 * @returns the stub handle carrying the registry face and per-namespace form stubs.
 */
export function stubConfigForms(): StubConfigForms {
  const scopes = new Map<string, StubConfigForm<unknown>>()
  const served = new Set<string>()
  const registered: Array<(served: ReadonlySet<string>) => () => void> = []
  return {
    registry: {
      get: <T>(namespace: string) => {
        const existing = scopes.get(namespace) as StubConfigForm<T> | undefined
        if (existing !== undefined) return existing.scope
        const scope = stubConfigForm<T>()
        scopes.set(namespace, scope)
        return scope.scope
      },
      whileServed: (namespaces, register) => {
        registered.push(register)
        if (namespaces.every(name => served.has(name))) return register(served)
        return () => {
          const at = registered.indexOf(register)
          if (at >= 0) registered.splice(at, 1)
        }
      },
    },
    scopes,
    serve: (namespaces) => {
      for (const name of namespaces) served.add(name)
      for (const register of [...registered]) register(served)
    },
  }
}
