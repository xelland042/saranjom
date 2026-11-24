import { afterEach, describe, expect, it, vi } from 'vitest'
import { presetRange } from './ListTools'

afterEach(() => vi.useRealTimers())
const on = (y: number, m: number, d: number) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(y, m - 1, d, 12))
}

describe('presetRange', () => {
  it('a week starts on Monday, a Sunday included', () => {
    on(2026, 11, 18) // Wednesday
    expect(presetRange('week')).toEqual({ from: '2026-11-16', to: '2026-11-18' })
    on(2026, 11, 22) // Sunday
    expect(presetRange('week')).toEqual({ from: '2026-11-16', to: '2026-11-22' })
  })
  it('this month and last month, across a year', () => {
    on(2026, 11, 18)
    expect(presetRange('month')).toEqual({ from: '2026-11-01', to: '2026-11-18' })
    expect(presetRange('lastMonth')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    on(2026, 1, 15)
    expect(presetRange('lastMonth')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    on(2024, 3, 10) // a leap February
    expect(presetRange('lastMonth')).toEqual({ from: '2024-02-01', to: '2024-02-29' })
  })
  it('all means no dates', () => {
    expect(presetRange('all')).toEqual({})
  })
})
