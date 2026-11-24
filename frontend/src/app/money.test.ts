import { describe, expect, it } from 'vitest'
import { currencyLabel, formatAmount, formatDecimal, formatMoney, parseAmount, parsePositive } from './money'

const NB = ' ' // the narrow no-break space between thousands

describe('formatAmount', () => {
  it('groups thousands and drops zero cents', () => {
    expect(formatAmount('385000.00')).toBe(`385${NB}000`)
    expect(formatAmount('1234567.05')).toBe(`1${NB}234${NB}567.05`)
    expect(formatAmount('0.00')).toBe('0')
  })
  it('always shows two decimals when there are cents', () => {
    expect(formatAmount('29.5')).toBe('29.50')
  })
})

describe('formatDecimal', () => {
  it('drops trailing zeros and shows a real minus', () => {
    expect(formatDecimal('12010.450000')).toBe(`12${NB}010.45`)
    expect(formatDecimal('-3.500')).toBe('−3.5')
    expect(formatDecimal('5.000')).toBe('5')
  })
})

describe('parseAmount: what people type, in the API form', () => {
  it('accepts spaces and a comma', () => {
    expect(parseAmount('385 000')).toBe('385000')
    expect(parseAmount('29,5')).toBe('29.5')
    expect(parseAmount(`1${NB}200`)).toBe('1200')
  })
  it('null for an empty box, undefined for a wrong one', () => {
    expect(parseAmount('  ')).toBeNull()
    for (const bad of ['abc', '-5', '1.234', '1,2,3']) expect(parseAmount(bad)).toBeUndefined()
  })
})

describe('parsePositive', () => {
  it('takes up to the given decimals, above zero only', () => {
    expect(parsePositive('12 850,5', 3)).toBe('12850.5')
    expect(parsePositive('0.001', 3)).toBe('0.001')
    expect(parsePositive('0', 3)).toBeUndefined()
    expect(parsePositive('1.2345', 3)).toBeUndefined()
    expect(parsePositive('', 3)).toBeUndefined()
  })
})

describe('currencies', () => {
  it('names soʻm in each language, other codes as they are', () => {
    expect(currencyLabel('UZS', 'uz')).toBe('soʻm')
    expect(currencyLabel('UZS', 'uz-Cyrl')).toBe('сўм')
    expect(currencyLabel('UZS', 'ru')).toBe('сум')
    expect(formatMoney('29.50', 'USD', 'ru')).toBe('29.50 USD')
  })
})
