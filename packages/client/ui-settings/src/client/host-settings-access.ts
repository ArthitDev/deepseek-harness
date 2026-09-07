interface PageAuthority {
  readonly hostname: string
  readonly protocol: string
}

const LOCAL_TAILNET_HOST = 'msi-cyborg-15-nb.tailaa5429.ts.net'
const KALI_TAILNET_HOST = '100.123.30.41'

/**
 * Allow this local build's authenticated Tailnet origins to use Host settings.
 * @param isLoopback - Whether the browser origin is loopback.
 * @param page - The current page authority when a browser window exists.
 * @returns Whether the Client may use Host-backed settings.
 */
export function canUseHostSettings(isLoopback: boolean, page: PageAuthority | undefined): boolean {
  return isLoopback
    || (page?.protocol === 'https:' && page.hostname === LOCAL_TAILNET_HOST)
    || (page?.protocol === 'http:' && page.hostname === KALI_TAILNET_HOST)
}
