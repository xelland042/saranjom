// What a role can't use is hidden on screen and refused by the server.
import { expect, test } from '@playwright/test'
import { api, newLogin, PASSWORD, signUp, t } from './helpers'

test('a person whose role has no money sees no debts, and the server refuses them', async ({ page, browser }) => {
  await signUp(page)
  const role = await api<{ id: number }>(page, 'POST', '/roles', { name: 'Omborchi 2', permissions: ['customers.read', 'stock.read'] })
  const login = newLogin()
  await api(page, 'POST', '/staff', { name: 'Sardor Karimov', login, password: PASSWORD, role_id: role.id })

  const staff = await (await browser.newContext()).newPage()
  await staff.goto('/')
  await staff.locator('#auth-login-login').fill(login)
  await staff.locator('#auth-login-password').fill(PASSWORD)
  await staff.getByRole('button', { name: t('submitLogin') }).click()
  await expect(staff.getByRole('button', { name: /Sardor Karimov/ })).toBeVisible()

  await staff.goto('/debts')
  await expect(staff.getByText(t('noAccess'))).toBeVisible()
  expect((await staff.request.get('/api/v1/debts')).status()).toBe(403)
  expect((await staff.request.get('/api/v1/customers')).status()).toBe(200)
  await staff.context().close()
})
