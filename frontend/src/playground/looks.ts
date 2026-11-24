// Four looks from two switches: frosted glass or solid panels, dark or light.
// The look is the first part of the address: /#/home is Glass, /#light/home, /#plain/home, /#plain-dark/home.
export type Look = 'glass' | 'light' | 'plain' | 'plain-dark'

const LOOKS: Look[] = ['glass', 'light', 'plain', 'plain-dark']

export const lookFromHash = (hash: string): Look => {
  const prefix = hash.slice(1).split('/')[0]
  return (LOOKS as string[]).includes(prefix) ? (prefix as Look) : 'glass'
}

export const makeLook = (frosted: boolean, dark: boolean): Look =>
  frosted ? (dark ? 'glass' : 'light') : dark ? 'plain-dark' : 'plain'

// The address prefix for a look; Glass has none.
export const lookPrefix = (look: Look) => (look === 'glass' ? '' : look)
