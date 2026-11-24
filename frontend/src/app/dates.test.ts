import { afterEach, describe, expect, it, vi } from 'vitest'
import { daysSince, formatDate, formatDay, isoToday, localDate } from './dates'

afterEach(() => vi.useRealTimers())

describe('dates', () => {
  it('reads an API date as a local day, not UTC midnight', () => {
    const d = localDate('2026-11-17')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 10, 17])
  })
  it('spells days out in each language', () => {
    const d = localDate('2026-11-17') // a Tuesday
    expect(formatDay(d, 'uz')).toBe('2026-yil 17-noyabr')
    expect(formatDay(d, 'uz-Cyrl')).toBe('2026-йил 17-ноябр')
    expect(formatDay(d, 'ru')).toBe('17 ноября 2026')
    expect(formatDate(d, 'uz')).toBe('17-noyabr, seshanba')
    expect(formatDate(d, 'ru')).toBe('17 ноября, вторник')
  })
  it('counts days from the local today, late at night too', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 23, 23, 59))
    expect(isoToday()).toBe('2026-11-23')
    expect(daysSince('2026-11-20')).toBe(3)
    expect(daysSince('2026-11-25')).toBe(-2)
  })
})
