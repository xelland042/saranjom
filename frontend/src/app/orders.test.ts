import { describe, expect, it } from 'vitest'
import { payState, vatOn, type Order } from './orders'

const TODAY = '2026-11-23'
const order = (o: Partial<Order>) =>
  ({ status: 'confirmed', total: '1000.00', unpaid: '1000.00', due_date: '2026-11-30', returned_total: '0.00', ...o }) as Order

describe('payState', () => {
  it('reads what is left to pay against the due date', () => {
    expect(payState(order({}), TODAY)).toBe('unpaid')
    expect(payState(order({ unpaid: '400.00' }), TODAY)).toBe('partial')
    expect(payState(order({ unpaid: '0.00' }), TODAY)).toBe('paid')
    expect(payState(order({ unpaid: '400.00', due_date: '2026-11-22' }), TODAY)).toBe('overdue')
  })
  it('paid stays paid after the due date', () => {
    expect(payState(order({ unpaid: '0.00', due_date: '2026-11-01' }), TODAY)).toBe('paid')
  })
  it('a return makes the order smaller, not paid', () => {
    // 300 came back, nothing was paid: still unpaid, not "partly paid"
    expect(payState(order({ unpaid: '700.00', returned_total: '300.00' }), TODAY)).toBe('unpaid')
    expect(payState(order({ unpaid: '500.00', returned_total: '300.00' }), TODAY)).toBe('partial')
  })
  it('no badge for drafts, cancelled or fully returned orders', () => {
    expect(payState(order({ status: 'draft' }), TODAY)).toBeNull()
    expect(payState(order({ status: 'cancelled' }), TODAY)).toBeNull()
    expect(payState(order({ unpaid: null, returned_total: '1000.00' }), TODAY)).toBeNull()
  })
})

describe('vatOn', () => {
  const rates = [
    { id: 2, rate: '12.00', valid_from: '2023-01-01' },
    { id: 1, rate: '15.00', valid_from: '2020-01-01' },
  ]
  it('takes the rate valid on the day, newest first', () => {
    expect(vatOn(rates, '2026-11-23')).toBe(12)
    expect(vatOn(rates, '2023-01-01')).toBe(12)
    expect(vatOn(rates, '2022-12-31')).toBe(15)
  })
  it('no VAT before the first rate', () => {
    expect(vatOn(rates, '2019-12-31')).toBe(0)
    expect(vatOn(undefined, '2026-11-23')).toBe(0)
  })
})
