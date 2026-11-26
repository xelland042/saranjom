// The cash box and the bank: the amount the company starts with, a customer's cash, an expense,
// cash carried to the bank, and a wrong expense cancelled.
import { expect, test, type Page } from '@playwright/test'
import { amount, api, confirmedOrder, seedShop, signUp, t, toast } from './helpers'

const box = (page: Page, place: 'placeCash' | 'placeBank') => page.getByRole('region', { name: new RegExp(`^${t(place)},`) })
const save = (page: Page) => page.getByRole('dialog').getByRole('button', { name: t('save') }).click()

test('money in the cash box and the bank follows payments, expenses and transfers', async ({ page }) => {
  await signUp(page)
  const { customer } = await seedShop(page)

  // nothing yet: the empty page offers the starting amount
  await page.goto('/debts')
  await page.getByRole('link', { name: t('cashTab') }).click()
  await page.getByRole('button', { name: t('enterOpening') }).click()
  await expect(page.getByRole('dialog').getByRole('combobox').first()).toHaveText(t('catOpening'))
  await page.locator('#move-amount').fill('2 000 000')
  await save(page)
  await expect(toast(page, t('saved'))).toBeVisible()
  await expect(box(page, 'placeCash')).toContainText(amount(2_000_000))

  // a customer pays in cash: it lands in the cash box by itself
  await api(page, 'POST', '/payments', { customer_id: customer.id, amount: '500000', currency: 'UZS', method: 'cash' })
  await page.reload()
  await expect(box(page, 'placeCash')).toContainText(amount(2_500_000))
  await expect(page.getByRole('link', { name: customer.name })).toBeVisible()

  // an expense won't save without an amount; then it takes the money out
  await page.getByRole('button', { name: t('addExpense'), exact: true }).click()
  await save(page)
  await expect(page.getByText(t('invalidAmount'))).toBeVisible()
  await page.locator('#move-amount').fill('300 000')
  await save(page)
  await expect(box(page, 'placeCash')).toContainText(amount(2_200_000))
  await expect(page.getByText(`${t('moneyExpense')}: ${t('catRent')}`)).toBeVisible()

  // cash carried to the bank
  await page.getByRole('button', { name: t('addTransfer') }).click()
  await page.locator('#move-amount').fill('1 000 000')
  await save(page)
  await expect(box(page, 'placeCash')).toContainText(amount(1_200_000))
  await expect(box(page, 'placeBank')).toContainText(amount(1_000_000))

  // the expense was a mistake: cancelled, it stays in the list and the money is back
  await page.getByRole('button', { name: `${t('cancelDoc')}: ${t('moneyExpense')} № 2` }).click()
  await page.getByRole('button', { name: t('confirmCancelPayment') }).click()
  await expect(toast(page, t('moveCancelled'))).toBeVisible()
  await expect(box(page, 'placeCash')).toContainText(amount(1_500_000))
  await expect(page.getByText(t('cancelledBadge'))).toBeVisible()
})

test('the profit report: sales less the cost of the goods less expenses, and what has no cost', async ({ page }) => {
  await signUp(page)
  const shop = await seedShop(page) // its product arrived without a price
  await confirmedOrder(page, shop, '10') // 150 000 of sales with no known cost
  const lists = await api<{ id: number; is_default: boolean }[]>(page, 'GET', '/price-lists')
  const rice = await api<{ id: number }>(page, 'POST', '/products', { name: 'Guruch 25 kg', unit: 'bag', prices: [{ price_list_id: lists.find((l) => l.is_default)!.id, amount: '150000' }] })
  await api(page, 'POST', '/stock-documents', { kind: 'receipt', warehouse_id: shop.warehouse, currency: 'UZS', lines: [{ product_id: rice.id, quantity: '10', price: '100000' }] })
  const order = await api<{ id: number }>(page, 'POST', '/orders', { customer_id: shop.customer.id, lines: [{ product_id: rice.id, quantity: '4', price: '150000' }] })
  await api(page, 'POST', `/orders/${order.id}/confirm`, {})
  await api(page, 'POST', '/money-moves', { kind: 'expense', place: 'bank', currency: 'UZS', amount: '50000', category: 'rent' })
  await api(page, 'POST', '/money-moves', { kind: 'income', place: 'cash', currency: 'UZS', amount: '9000000', category: 'opening' })

  await page.goto('/debts')
  await page.getByRole('link', { name: t('profitTab') }).click()
  const row = (label: string) => page.locator('dt', { hasText: label }).locator('..')
  await expect(row(t('profitSalesHint'))).toContainText(amount(750_000))
  await expect(row(t('profitCost'))).toContainText(amount(400_000))
  await expect(row(t('profitGross'))).toContainText(amount(350_000))
  await expect(row(t('catRent'))).toContainText(amount(50_000))
  await expect(row(t('profitNet'))).toContainText(amount(300_000))
  // the product sold without a cost is named, with what it sold for
  const warning = page.getByRole('status').filter({ hasText: t('uncostedTitle') })
  await expect(warning.getByRole('link', { name: shop.product.name })).toBeVisible()
  await expect(warning).toContainText(amount(150_000))
})
