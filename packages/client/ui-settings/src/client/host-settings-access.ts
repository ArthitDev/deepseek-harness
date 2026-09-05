interface PageAuthority {
  readonly hostname: string
  readonly protocol: string
}

const LOCAL_TAILNET_HOST = 'msi-cyborg-15-nb.tailaa5429.ts.net'

/** Allow this local build's authenticated HTTPS Tailnet origin to use Host settings. */
export function canUseHostSettings(isLoopback: boolean, page: PageAuthority | undefined): boolean {
  return isLoopback || (page?.protocol === 'https:' && page.hostname === LOCAL_TAILNET_HOST)
}
