import { useState } from 'react'

// An on/off choice remembered in this browser (a per-viewer convenience, so storage may fail safely).
export function useStoredFlag(key: string, initial = false) {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key)
      return v === null ? initial : v === '1'
    } catch {
      return initial
    }
  })
  const set = (v: boolean) => {
    setValue(v)
    try {
      localStorage.setItem(key, v ? '1' : '0')
    } catch {
      // not remembered, still switched
    }
  }
  return [value, set] as const
}
