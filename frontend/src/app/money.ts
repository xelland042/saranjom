// Prices: shown with grouped thousands ("385 000 soʻm", "29.50 USD"), typed however people type them.
import type { Lang } from './i18n'

// Offered first when a price list is created; the server accepts any ISO 4217 code.
export const CURRENCIES = ['UZS', 'USD', 'EUR', 'RUB', 'CNY', 'KZT', 'KGS', 'TJS', 'TRY', 'AED', 'GBP', 'JPY', 'KRW', 'INR']

const SOM: Record<Lang, string> = { uz: 'soʻm', 'uz-Cyrl': 'сўм', ru: 'сум' }
export const currencyLabel = (code: string, lang: Lang) => (code === 'UZS' ? SOM[lang] : code)

// "385000.00" -> "385 000", "29.50" -> "29.50"; whole amounts drop the cents. Hand-made, like dates,
// because browsers lack Uzbek number data; the narrow no-break space keeps a number on one line.
export function formatAmount(amount: string) {
  const [whole, cents = ''] = amount.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return /^0*$/.test(cents) ? grouped : `${grouped}.${cents.padEnd(2, '0')}`
}

export const formatMoney = (amount: string, currency: string, lang: Lang) => `${formatAmount(amount)} ${currencyLabel(currency, lang)}`

// What people type ("385 000", "29,5") to the API's form ("385000", "29.5"); null for an empty box,
// undefined when it isn't a valid price.
export function parseAmount(typed: string): string | null | undefined {
  const s = typed.replace(/[\s  ]/g, '').replace(',', '.')
  if (!s) return null
  return /^\d{1,16}(\.\d{1,2})?$/.test(s) ? s : undefined
}

// A decimal from the API ("12010.450000", "-3.500") as "12 010.45", "−3.5": no trailing zeros.
// Used for rates and quantities.
export function formatDecimal(value: string) {
  const negative = value.startsWith('-')
  const [whole, frac = ''] = value.replace('-', '').split('.')
  const digits = frac.replace(/0+$/, '')
  return (negative ? '\u2212' : '') + formatAmount(whole) + (digits ? `.${digits}` : '')
}

// A typed positive number ("12 850,5") in the API's form, with at most `decimals` decimals, or
// undefined when it isn't one. Rates take 6 decimals, quantities 3.
export function parsePositive(typed: string, decimals: number): string | undefined {
  const s = typed.replace(/[\s\u202f\u00a0]/g, '').replace(',', '.')
  return new RegExp(`^\\d{1,12}(\\.\\d{1,${decimals}})?$`).test(s) && Number(s) > 0 ? s : undefined
}
