// The Excel import with a list the way 1C saves it: a title row above the table, a folder row, a bad
// ИНН and Excel's own number formats.
import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { api, signUp, t, toast } from './helpers'

const FILE = fileURLToPath(new URL('./fixtures/customers-1c.xlsx', import.meta.url))

test('a 1C customer list imports, its folder row left out and its bad row skipped', async ({ page }) => {
  await signUp(page)
  await page.goto('/customers')
  await page.getByRole('button', { name: t('importButton') }).click()
  await page.locator('input[type=file]').setInputFiles(FILE)

  // the header is found under the title, and its columns recognised: each shows its first value
  await expect(page.getByText(`${t('importRows')}: 4`)).toBeVisible()
  await expect(page.getByRole('dialog').getByText('Покупатели')).toBeVisible()
  await expect(page.getByRole('dialog').getByText('304111222')).toBeVisible()
  await page.getByRole('button', { name: t('importCheck') }).click()

  await expect(page.getByText(`${t('importNew')}: 3`, { exact: true })).toBeVisible()
  await expect(page.getByText(`${t('importRow')} 7 · ${t('inn')}: ${t('importErr_invalid')}`)).toBeVisible()
  // 1C's folder comes out as a row with only a name: untick it, and the preview counts again
  await page.getByRole('checkbox', { name: /Покупатели/ }).click()
  await expect(page.getByText(`${t('importNew')}: 2`, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: t('importDo') }).click()
  await expect(toast(page, t('imported'), { partial: true })).toBeVisible()

  const list = await api<{ items: { name: string; inn: string | null; balances: { balance: string }[] }[] }>(page, 'GET', '/customers')
  expect(list.items.map((c) => c.name).sort()).toEqual(['Navroʻz Doʻkoni', 'Yangi Bozor MChJ'])
  const yangi = list.items.find((c) => c.name === 'Yangi Bozor MChJ')!
  expect([yangi.inn, yangi.balances[0].balance]).toEqual(['305222333', '2300000.50'])
})
