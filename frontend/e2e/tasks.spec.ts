// A task added on the board and ticked off in the list.
import { expect, test } from '@playwright/test'
import { signUp, t, toast } from './helpers'

test('a task added on the board is ticked off in the list and shows as done', async ({ page }) => {
  await signUp(page)
  await page.goto('/tasks')
  // each column opens its own quick-add box
  await page.getByRole('button', { name: t('addTask') }).first().click()
  const quickAdd = page.getByRole('textbox', { name: new RegExp(`^${t('newTask')}: `) }).first()
  await quickAdd.fill('Baraka Marketga qoʻngʻiroq qilish')
  await quickAdd.press('Enter')
  await expect(page.getByText('Baraka Marketga qoʻngʻiroq qilish')).toBeVisible()

  await page.goto('/tasks?view=list')
  await page.getByRole('checkbox', { name: `${t('markDone')}: Baraka Marketga qoʻngʻiroq qilish` }).click()
  await expect(toast(page, t('taskDone'))).toBeVisible() // saved, with an undo
  await page.goto('/tasks?view=done')
  await expect(page.getByText('Baraka Marketga qoʻngʻiroq qilish')).toBeVisible()
})
