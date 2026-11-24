import { describe, expect, it } from 'vitest'
import type { Permission } from './api'
import { AREAS, togglePermission } from './staff'

const money = AREAS.find((a) => a.see === 'money.read')!

describe('togglePermission', () => {
  it('changing implies seeing', () => {
    expect([...togglePermission(new Set(), money, 'change', true)].sort()).toEqual(['money.read', 'money.write'])
  })
  it('no longer seeing means no longer changing', () => {
    const both = new Set<Permission>(['money.read', 'money.write'])
    expect([...togglePermission(both, money, 'see', false)]).toEqual([])
  })
  it('unticking changing keeps seeing', () => {
    const both = new Set<Permission>(['money.read', 'money.write'])
    expect([...togglePermission(both, money, 'change', false)]).toEqual(['money.read'])
  })
  it('leaves the given set alone', () => {
    const start = new Set<Permission>(['money.read'])
    togglePermission(start, money, 'change', true)
    expect([...start]).toEqual(['money.read'])
  })
})
