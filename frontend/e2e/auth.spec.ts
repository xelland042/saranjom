import { expect, test } from '@playwright/test'
import { newLogin, PASSWORD, t } from './helpers'

test('sign up, log out, log back in; a wrong password is refused', async ({ page }) => {
  const login = newLogin()
  await page.goto('/')
  await page.getByRole('tab', { name: t('signupTab') }).click()
  await page.locator('#auth-signup-company_name').fill('Gʻalla Savdo')
  await page.locator('#auth-signup-name').fill('Ali Valiyev')
  await page.locator('#auth-signup-login').fill(login)
  await page.locator('#auth-signup-password').fill(PASSWORD)
  await page.getByRole('button', { name: t('submitSignup') }).click()
  // inside: the dock's user button carries the person's initials
  await expect(page.getByRole('button', { name: /Ali Valiyev/ })).toBeVisible()

  await page.getByRole('button', { name: /Ali Valiyev/ }).click()
  await page.getByRole('menuitem', { name: t('logout') }).click()
  await expect(page.getByRole('tab', { name: t('loginTab') })).toBeVisible()

  await page.locator('#auth-login-login').fill(login)
  await page.locator('#auth-login-password').fill('not-the-password')
  await page.getByRole('button', { name: t('submitLogin') }).click()
  await expect(page.getByText(t('wrong'))).toBeVisible()

  await page.locator('#auth-login-password').fill(PASSWORD)
  await page.getByRole('button', { name: t('submitLogin') }).click()
  await expect(page.getByRole('button', { name: /Ali Valiyev/ })).toBeVisible()
})
