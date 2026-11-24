import { useEffect, useState, type ReactNode } from 'react'
import type { Look } from '@/playground/looks'
import { useLang } from './i18n'
import { PrefsContext, savedLook } from './prefs'

export function PrefsProvider({ children }: { children: ReactNode }) {
  const { lang, setLang, t } = useLang()
  const [look, setLookState] = useState<Look>(savedLook)
  const setLook = (l: Look) => {
    setLookState(l)
    try {
      localStorage.setItem('look', l)
    } catch {
      // not remembered, still switched
    }
  }
  // Popups render in <body>, outside any page, so the look and language go on <html>.
  useEffect(() => {
    document.documentElement.dataset.look = look
    document.documentElement.lang = lang
  }, [look, lang])
  const dark = look === 'glass' || look === 'plain-dark'
  const frosted = look === 'glass' || look === 'light'
  return (
    <PrefsContext.Provider value={{ look, setLook, dark, frosted, lang, setLang, t }}>{children}</PrefsContext.Provider>
  )
}
