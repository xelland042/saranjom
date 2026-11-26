// Buying: a supplier, goods arriving from them, what we owe, and paying it.
import { expect, test } from '@playwright/test'
import { api, seedShop, signUp, t, toast } from './helpers'

test('goods from a supplier add to what we owe; a payment takes it down', async ({ page }) => {
  await signUp(page)
  const { product } = await seedShop(page)

  await page.goto('/stock/suppliers')
  await page.getByRole('button', { name: t('addSupplier') }).click()
  await page.locator('#supplier-name').fill('Tegirmon MChJ')
  await page.locator('#supplier-inn').fill('305 111 222')
  await page.getByRole('dialog').getByRole('button', { name: t('save') }).click()
  await expect(toast(page, t('saved'))).toBeVisible()
  await expect(page).toHaveURL(/\/stock\/suppliers\/\d+$/)
  await expect(page.getByText(t('weOweNothing'))).toBeVisible()

  // an arrival started from the supplier's page already names them; it won't post without a price
  await page.getByRole('link', { name: t('newArrival') }).click()
  await expect(page.getByText(t('purchaseHint'))).toBeVisible()
  await page.getByRole('combobox', { name: t('chooseProduct') }).first().fill(product.name.slice(0, 4))
  await page.getByRole('option', { name: new RegExp(product.name) }).click()
  await page.getByLabel(`${t('quantity')} 1`).fill('20')
  await page.getByRole('button', { name: t('postDocument') }).click()
  await expect(page.getByText(t('invalidPrice'))).toBeVisible()
  await page.getByLabel(`${t('price')} 1`).fill('185 000')
  await page.getByRole('button', { name: t('postDocument') }).click()
  await expect(toast(page, t('posted'))).toBeVisible()
  await expect(page.getByRole('link', { name: 'Tegirmon MChJ' })).toBeVisible()
  await expect(page.getByText(t('purchaseTotal'))).toContainText('3 700 000')

  // the supplier's page: the debt, then a part payment
  await page.getByRole('link', { name: 'Tegirmon MChJ' }).click()
  await expect(page.getByRole('heading', { name: t('weOwe') }).locator('..')).toContainText('3 700 000')
  await page.getByRole('button', { name: t('paySupplier') }).click()
  await page.locator('#payout-amount').fill('1 200 000')
  await page.getByRole('dialog').getByRole('button', { name: t('paySupplier') }).click()
  await expect(toast(page, t('paymentSaved'))).toBeVisible()
  await expect(page.getByRole('heading', { name: t('weOwe') }).locator('..')).toContainText('2 500 000')

  // the list, only those we owe, shows them and the sum
  await page.goto('/stock/suppliers?owed=true')
  await expect(page.getByRole('row', { name: /Tegirmon MChJ/ })).toContainText('2 500 000')
  await expect(page.getByText(t('weOweTotal'))).toContainText('2 500 000')

  // the 100 the shop started with, and the 20 that arrived
  const stock = await api<{ items: { name: string; total: string }[] }>(page, 'GET', '/stock')
  expect(stock.items.find((r) => r.name === product.name)?.total).toBe('120.000')
})
