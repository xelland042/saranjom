// Customers, products and stock, entered through their own forms.
import { expect, test } from '@playwright/test'
import { api, signUp, t, toast } from './helpers'

test('a customer added in the form is found in Cyrillic too; a taken ИНН is caught', async ({ page }) => {
  await signUp(page)
  await page.goto('/customers')
  await page.getByRole('button', { name: t('addCustomer') }).click()
  await page.locator('#customer-name').fill('Gʻalla Savdo MChJ')
  await page.locator('#customer-inn').fill('301 234 567')
  await page.getByRole('dialog').getByRole('button', { name: t('save') }).click()
  await expect(toast(page, t('saved'))).toBeVisible()

  // search keys match across scripts: Cyrillic finds the Latin name
  await page.goto('/customers?q=галла')
  await expect(page.getByRole('link', { name: /Gʻalla Savdo MChJ/ })).toBeVisible()

  await page.getByRole('button', { name: t('addCustomer') }).click()
  await page.locator('#customer-name').fill('Boshqa firma')
  await page.locator('#customer-inn').fill('301234567')
  await page.getByRole('dialog').getByRole('button', { name: t('save') }).click()
  await expect(page.getByText(t('innTaken'))).toBeVisible()
})

test('a product with its price, then a receipt, shows in stock', async ({ page }) => {
  await signUp(page)
  await page.goto('/products')
  await page.getByRole('button', { name: t('addProduct') }).click()
  await page.locator('#product-name').fill('Shakar 1 kg')
  await page.locator('[id^="product-price-"]').first().fill('12 500')
  await page.getByRole('dialog').getByRole('button', { name: t('save') }).click()
  await expect(toast(page, t('saved'))).toBeVisible()
  const [product] = (await api<{ items: { id: number; prices: { amount: string }[] }[] }>(page, 'GET', '/products')).items
  expect(product.prices[0].amount).toBe('12500.00')

  await page.goto('/stock/documents/new?kind=receipt')
  await page.getByRole('combobox', { name: t('chooseProduct') }).first().fill('Shakar')
  await page.getByRole('option', { name: /Shakar 1 kg/ }).click()
  await page.getByLabel(`${t('quantity')} 1`).fill('40')
  await page.getByRole('button', { name: t('postDocument') }).click()
  await expect(toast(page, t('posted'))).toBeVisible()
  await expect(page).toHaveURL(/\/stock\/documents\/\d+$/)

  await page.goto('/stock')
  await expect(page.getByRole('row', { name: /Shakar 1 kg/ })).toContainText('40')
})
