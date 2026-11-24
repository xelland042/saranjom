// Shared by the end-to-end tests: the app's own words (so a reworded button can't silently break a
// test), a fresh company per test, and API calls to set up what a test isn't about.
import { expect, type Page } from '@playwright/test'
import { T, type Key } from '../src/app/i18n'

// the app opens in Uzbek (Latin)
export const t = (k: Key) => T[k][0]

export const PASSWORD = 'e2e-secret-123'

// a phone number no other test uses (the database is fresh each run)
export const newLogin = () => `+99890${Math.floor(1_000_000 + Math.random() * 8_999_999)}`

// a call to our API with the page's cookies, as the app makes it; fails the test on an error
export async function api<T = unknown>(page: Page, method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, data?: unknown): Promise<T> {
  const r = await page.request.fetch(`/api/v1${path}`, { method, data })
  expect(r.ok(), `${method} ${path}: ${r.status()} ${await r.text()}`).toBeTruthy()
  return (r.status() === 204 ? undefined : await r.json()) as T
}

// a new company with its owner logged in; the tests that aren't about signing up start here
export async function signUp(page: Page, company = 'E2E Savdo') {
  const login = newLogin()
  await api(page, 'POST', '/auth/signup', { company_name: company, name: 'Ali Valiyev', login, password: PASSWORD })
  return login
}

export type Seeded = { customer: { id: number; name: string }; product: { id: number; name: string }; warehouse: number }

// a customer, a product priced 15 000 and 100 of it in the default warehouse
export async function seedShop(page: Page): Promise<Seeded> {
  const customer = await api<{ id: number; name: string }>(page, 'POST', '/customers', { name: 'Baraka Market MChJ', inn: '301234567' })
  const lists = await api<{ id: number; is_default: boolean }[]>(page, 'GET', '/price-lists')
  const product = await api<{ id: number; name: string }>(page, 'POST', '/products', {
    name: 'Un oliy nav 50 kg',
    unit: 'bag',
    prices: [{ price_list_id: lists.find((l) => l.is_default)!.id, amount: '15000' }],
  })
  const warehouse = (await api<{ id: number }[]>(page, 'GET', '/warehouses'))[0].id
  await api(page, 'POST', '/stock-documents', { kind: 'receipt', warehouse_id: warehouse, lines: [{ product_id: product.id, quantity: '100' }] })
  return { customer, product, warehouse }
}

// a confirmed order of `quantity` of the seeded product
export async function confirmedOrder(page: Page, s: Seeded, quantity = '10') {
  const order = await api<{ id: number; number: number; lines: { id: number }[] }>(page, 'POST', '/orders', {
    customer_id: s.customer.id,
    lines: [{ product_id: s.product.id, quantity, price: '15000' }],
  })
  return api<{ id: number; number: number; total: string; lines: { id: number }[] }>(page, 'POST', `/orders/${order.id}/confirm`, {})
}

// "150 000": amounts as the app shows them, with its narrow no-break space
export const amount = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ')

// a toast's text, looked for only among the notifications (the same words often appear in the history)
export const toast = (page: Page, text: string, o: { partial?: boolean } = {}) =>
  page.getByRole('region', { name: /Notifications/ }).getByText(text, { exact: !o.partial })
