/**
 * Inspect the Docker container response against the deployment's fixed isolation requirements.
 * @param container - Docker inspection response to validate.
 */
export function validateContainer(container: unknown): void

/** Paths and configured name for the restricted Kali broker. */
export interface BrokerOptions {
  dockerSocket: string
  socketPath: string
  containerName?: string
}

/** A listening broker and its startup identity. */
export interface KaliBroker {
  readonly containerId: string
  close(): Promise<void>
}

/**
 * Start the Unix-socket broker; each new exec resolves and validates the configured container again.
 * @param options - Docker socket, client socket, and optional configured container name.
 * @returns the startup container identity and a disposer for owned connections.
 */
export function createBroker(options: BrokerOptions): Promise<KaliBroker>
