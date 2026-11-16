import type { Server } from 'node:http'

/** Create the fixed local control protocol; callers own listening and teardown.
 * @param run - trusted local Mullvad executor, never supplied by a request.
 * @returns HTTP server with reconnect exclusion shared across its clients.
 */
export function createVpnControlServer(run: (action: 'status' | 'reconnect') => Promise<{ state?: string } | undefined>): Server
