// Per-browser preferences: the look (Glass, Light, Plain, Plain dark) and the language.
// Both are remembered in the browser and available everywhere through usePrefs(); see PrefsProvider.
import { createContext, useContext } from 'react'
import { makeLook, type Look } from '@/playground/looks'
import type { Key, Lang } from './i18n'

const LOOKS: Look[] = ['glass', 'light', 'plain', 'plain-dark']

export function savedLook(): Look {
  try {
    const v = localStorage.getItem('look') as Look | null
    if (v && LOOKS.includes(v)) return v
  } catch {
    // storage blocked: fall through
  }
  // first visit: follow the system's light or dark setting
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'glass'
}

export type Prefs = {
  look: Look
  setLook: (l: Look) => void
  dark: boolean
  frosted: boolean
  lang: Lang
  setLang: (l: Lang) => void
  t: (k: Key) => string
}

export const PrefsContext = createContext<Prefs | null>(null)

export function usePrefs() {
  const p = useContext(PrefsContext)
  if (!p) throw new Error('usePrefs needs PrefsProvider')
  return p
}

export const toggleLook = (p: Prefs, change: { frosted?: boolean; dark?: boolean }) =>
  p.setLook(makeLook(change.frosted ?? p.frosted, change.dark ?? p.dark))
