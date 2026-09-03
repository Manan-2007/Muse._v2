/**
 * Types for the vendored JavaScript in `src/vendor`.
 *
 * That folder is excluded from the TypeScript project on purpose — third-party
 * code shouldn't have to satisfy this codebase's strictness — so the contracts
 * it exposes are declared here instead.
 */

declare module '@/vendor/InfiniteMenu' {
  import type { ComponentType } from 'react'

  export type InfiniteMenuItem = {
    /** Any URL an <img> can load, including a data: URI. */
    image: string
    title: string
    description?: string
    /** Carried through untouched so `onSelect` can identify the choice. */
    id: string
  }

  const InfiniteMenu: ComponentType<{
    items: InfiniteMenuItem[]
    /** Camera zoom. Above 1 pulls back, below pushes in. */
    scale?: number
    onSelect?: (item: InfiniteMenuItem) => void
    selectLabel?: string
  }>

  export default InfiniteMenu
}

declare module '@/vendor/Ballpit' {
  import type { ComponentType } from 'react'

  const Ballpit: ComponentType<{
    className?: string
    /** Number of spheres. Every one is another body in an O(n²) collision pass. */
    count?: number
    gravity?: number
    friction?: number
    wallBounce?: number
    /** Whether sphere 0 chases the pointer. */
    followCursor?: boolean
    /** Ramp the spheres are coloured along, as 0xRRGGBB numbers. */
    colors?: number[]
    ambientColor?: number
    ambientIntensity?: number
    lightIntensity?: number
    minSize?: number
    maxSize?: number
    size0?: number
    maxVelocity?: number
    maxX?: number
    maxY?: number
    maxZ?: number
  }>

  export default Ballpit
}
