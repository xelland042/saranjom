// Dashboard layout: an ordered list of widgets, each with a width in grid columns.
export type Widget = { id: string; size: number }

// Reads a saved layout. Drops unknown widgets, sizes a widget doesn't allow and duplicates; null if unreadable.
export function parseLayout(raw: string | null, sizes: Record<string, readonly number[]>): Widget[] | null {
  try {
    const v: unknown = JSON.parse(raw ?? '')
    if (!Array.isArray(v)) return null
    const seen = new Set<string>()
    return v.filter((w): w is Widget => {
      const ok = typeof w?.id === 'string' && Object.hasOwn(sizes, w.id) && sizes[w.id].includes(w.size) && !seen.has(w.id)
      if (ok) seen.add(w.id)
      return ok
    })
  } catch {
    return null
  }
}

export function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}
