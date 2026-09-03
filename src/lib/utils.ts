import type { CSSProperties } from 'react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Inline styles that also carry CSS custom properties. */
export type CSSVars = CSSProperties & Record<`--${string}`, string | number>
