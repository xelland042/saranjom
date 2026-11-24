// The money path: an order confirmed in the editor, a payment, a return, and what each does to stock
// and the customer's debt, as the screens show it.
import { expect, test } from '@playwright/test'
import { amount, api, confirmedOrder, seedShop, signUp, t, toast } from './helpers'

test('an order confirmed in the editor takes stock and becomes a debt', async ({ page }) => {
  await signUp(page)
  const s = await seedShop(page)
  await page.goto('/orders/new')
  await page.locator('#order-customer').fill('Baraka')
  await page.getByRole('option', { name: /Baraka Market/ }).click()
  await page.getByRole('combobox', { name: t('chooseProduct') }).first().fill('Un oliy')
  await page.getByRole('option', { name: /Un oliy nav/ }).click()
  await page.getByLabel(`${t('quantity')} 1`).fill('10')
  // the price comes from the price list
  await expect(page.getByLabel(`${t('price')} 1`)).toHaveValue(/15\s?000/)
  await page.getByRole('button', { name: t('confirmOrder') }).click()

  await expect(page.getByText(t('statusConfirmed'))).toBeVisible()
  await expect(page.getByText(t('payUnpaid'))).toBeVisible()
  await expect(page.getByText(`${amount(150000)} soʻm`).first()).toBeVisible()
  const stock = await api<{ items: { product_id: number; total: string }[] }>(page, 'GET', '/stock')
  expect(stock.items.find((r) => r.product_id === s.product.id)?.total).toBe('90.000')
})

test('a payment on the customer page lowers the debt and shows in the akt sverki', async ({ page }) => {
  await signUp(page)
  const s = await seedShop(page)
  const order = await confirmedOrder(page, s) // 10 × 15 000
  await page.goto(`/customers/${s.customer.id}`)
  await page.getByRole('button', { name: t('receivePayment') }).first().click()
  await page.locator('#payment-amount').fill('50 000')
  await page.getByRole('button', { name: t('receive') }).click()
  await expect(toast(page, t('paymentSaved'))).toBeVisible()
  await expect(page.getByText(amount(100000)).first()).toBeVisible()

  await page.goto(`/customers/${s.customer.id}/statement`)
  await expect(page.getByRole('link', { name: `${t('sale')} № ${order.number}` })).toBeVisible()
  await expect(page.getByText(`${t('payment')} № 1`)).toBeVisible()
  await expect(page.getByText(amount(100000)).last()).toBeVisible()
})

test('a partial return restocks, lowers the debt and keeps the order unpaid, not partly paid', async ({ page }) => {
  await signUp(page)
  const s = await seedShop(page)
  const order = await confirmedOrder(page, s) // 10 × 15 000
  await page.goto(`/orders/${order.id}`)
  await page.getByRole('button', { name: t('returnGoods') }).click()
  await page.getByLabel(`${t('returnQty')}: ${s.product.name}`).fill('4')
  await page.getByRole('button', { name: t('returnSave') }).click()

  await expect(page).toHaveURL(/\/returns\/\d+$/)
  await expect(page.getByRole('heading', { name: `${t('returnDoc')} № 1` })).toBeVisible()
  await expect(page.getByText(`${amount(60000)} soʻm`).first()).toBeVisible()

  await page.getByRole('link', { name: `${t('order')} № ${order.number}` }).first().click()
  // nothing was paid: the badge must not say "partly paid" (a bug we had)
  await expect(page.getByText(t('payUnpaid'))).toBeVisible()
  await expect(page.getByText(t('payPartial'))).toHaveCount(0)
  await expect(page.getByText(`${amount(90000)} soʻm`).first()).toBeVisible()
  // on screen (the printed invoice repeats the lines)
  await expect(page.getByRole('region', { name: t('linesCount') }).getByText(`${t('returnedAlready')}: 4`)).toBeVisible()
  const stock = await api<{ items: { product_id: number; total: string }[] }>(page, 'GET', '/stock')
  expect(stock.items.find((r) => r.product_id === s.product.id)?.total).toBe('94.000')

  // the order can't be cancelled while its return counts: the goods would come back twice
  await page.getByRole('button', { name: t('cancelDoc') }).click()
  await page.getByRole('dialog').getByRole('button', { name: t('cancelDoc') }).click()
  await expect(toast(page, t('cancelReturnsFirst'))).toBeVisible()
})
