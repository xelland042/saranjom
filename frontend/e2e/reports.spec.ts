// The sales report (what was sold, to whom, by whom, and what was earned on it) and the stock
// count (what is on the shelves against what the books say).
import { expect, test } from '@playwright/test'
import { amount, api, confirmedOrder, seedShop, signUp, t, toast } from './helpers'

test('the sales report: by product with profit, then by customer', async ({ page }) => {
  await signUp(page)
  const shop = await seedShop(page)
  // a second product bought at 100 000 and sold at 150 000; the seeded one never had a cost
  const rice = await api<{ id: number }>(page, 'POST', '/products', { name: 'Guruch 25 kg', unit: 'bag' })
  await api(page, 'POST', '/stock-documents', { kind: 'receipt', warehouse_id: shop.warehouse, currency: 'UZS', lines: [{ product_id: rice.id, quantity: '10', price: '100000' }] })
  await confirmedOrder(page, shop)
  const order = await api<{ id: number }>(page, 'POST', '/orders', { customer_id: shop.customer.id, lines: [{ product_id: rice.id, quantity: '4', price: '150000' }] })
  await api(page, 'POST', `/orders/${order.id}/confirm`, {})

  await page.goto('/orders')
  await page.getByRole('link', { name: t('salesReport') }).click()
  const report = page.getByRole('region', { name: t('salesReport') })
  const riceRow = report.getByRole('row').filter({ hasText: 'Guruch 25 kg' })
  await expect(riceRow).toContainText(amount(600_000))
  await expect(riceRow).toContainText(amount(400_000))
  await expect(riceRow).toContainText(amount(200_000))
  await expect(riceRow).toContainText('33%')
  // the product with no known cost is marked
  const flourRow = report.getByRole('row').filter({ hasText: shop.product.name })
  await expect(flourRow).toContainText(amount(150_000))
  await expect(flourRow.getByText(t('reportUncosted'))).toBeAttached()
  await expect(report.getByRole('row').filter({ hasText: t('total') })).toContainText(amount(750_000))

  await page.getByRole('tab', { name: t('customers') }).click()
  await expect(page).toHaveURL(/by=customer/)
  const customer = report.getByRole('row').filter({ hasText: shop.customer.name })
  await expect(customer).toContainText(amount(750_000))
  await expect(customer.getByRole('link', { name: shop.customer.name })).toBeVisible()

  await page.getByRole('tab', { name: t('staff') }).click()
  await expect(report.getByRole('row').filter({ hasText: 'Ali Valiyev' })).toContainText(amount(750_000))
})

test('a stock count: the differences become documents', async ({ page }) => {
  await signUp(page)
  const shop = await seedShop(page) // 100 of the product
  await api(page, 'POST', '/products', { name: 'Guruch 25 kg', unit: 'bag' }) // and one with nothing in stock

  await page.goto('/stock')
  await page.getByRole('link', { name: t('stockCount') }).click()
  const count = (name: string) => page.getByLabel(`${t('countCounted')}: ${name}`)
  await count(shop.product.name).fill('97')
  await count('Guruch 25 kg').fill('2,5')
  const sheet = page.getByRole('region', { name: t('stockCount') })
  await expect(sheet.getByRole('row').filter({ hasText: shop.product.name })).toContainText('−3')
  await expect(sheet.getByRole('row').filter({ hasText: 'Guruch 25 kg' })).toContainText('+2.5')

  // what was typed survives a reload
  await page.reload()
  await expect(count(shop.product.name)).toHaveValue('97')

  // stock moves while the count is being typed in: refused, the new number shown
  await api(page, 'POST', '/stock-documents', { kind: 'write_off', warehouse_id: shop.warehouse, lines: [{ product_id: shop.product.id, quantity: '1' }] })
  await page.getByRole('button', { name: t('countFinish') }).click()
  await page.getByRole('button', { name: t('countYes') }).click()
  await expect(toast(page, t('countMoved'))).toBeVisible()
  await expect(sheet.getByRole('row').filter({ hasText: shop.product.name })).toContainText('−2')

  await page.getByRole('button', { name: t('countFinish') }).click()
  await page.getByRole('button', { name: t('countYes') }).click()
  const done = page.getByRole('status').filter({ hasText: t('countDone') })
  await expect(done.getByRole('link', { name: `${t('kindReceipt')} №` })).toBeVisible()
  await expect(done.getByRole('link', { name: `${t('kindWriteOff')} №` })).toBeVisible()
  await expect(count(shop.product.name)).toHaveValue('')
  await expect(sheet.getByRole('row').filter({ hasText: shop.product.name })).toContainText('97')
})
