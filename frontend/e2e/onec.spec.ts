// The 1C file: asked for the company's ИНН once, then downloaded with the period's sales.
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { confirmedOrder, seedShop, signUp, t } from './helpers'

test('the 1C file asks for the ИНН once and holds the period’s sales', async ({ page }) => {
  await signUp(page)
  const s = await seedShop(page)
  const order = await confirmedOrder(page, s)
  await page.goto('/debts')
  await page.getByRole('button', { name: t('export1c') }).click()
  await page.getByRole('combobox', { name: t('period') }).click()
  await page.getByRole('option', { name: t('rangeMonth') }).click()
  await page.locator('#onec-inn').fill('305 555 555')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: t('download') }).click()

  const file = await download
  expect(file.suggestedFilename()).toMatch(/^1c-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.xml$/)
  const xml = await readFile(await file.path(), 'utf8')
  expect(xml).toContain('http://v8.1c.ru/edi/edi_stnd/EnterpriseData/1.4') // the default version
  expect(xml).toContain('<Документ.РеализацияТоваровУслуг>')
  expect(xml).toContain(`<Номер>${order.number}</Номер>`)
  expect(xml).toContain('<ИНН>305555555</ИНН>')
  expect(xml).toContain('<ИНН>301234567</ИНН>') // the customer's

  // asked once: the next time the field isn't there
  await page.getByRole('button', { name: t('export1c') }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('#onec-inn')).toHaveCount(0)
})
