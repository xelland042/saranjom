// What a role can't use is hidden on screen and refused by the server.
import { expect, test } from '@playwright/test'
import { api, newLogin, PASSWORD, seedShop, signUp, t } from './helpers'

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

test('the demo button lets a visitor in as a guest who sees everything and changes nothing', async ({ page, browser }) => {
  await signUp(page, 'Demo Savdo')
  const shop = await seedShop(page)
  const looks = ['customers.read', 'orders.read', 'money.read', 'products.read', 'stock.read', 'dashboard']
  const role = await api<{ id: number }>(page, 'POST', '/roles', { name: 'Mehmon', permissions: looks })
  // the login scripts/e2e.sh names as the demo's guest
  await api(page, 'POST', '/staff', { name: 'Mehmon', login: 'e2emehmon', password: PASSWORD, role_id: role.id })

  const visitor = await (await browser.newContext()).newPage()
  await visitor.goto('/')
  await visitor.getByRole('button', { name: t('seeDemo') }).click()
  await expect(visitor.getByRole('button', { name: /Mehmon/ })).toBeVisible()

  await visitor.goto('/customers')
  await expect(visitor.getByText(shop.customer.name)).toBeVisible()
  await expect(visitor.getByRole('button', { name: t('addCustomer') })).toHaveCount(0)
  expect((await visitor.request.post('/api/v1/customers', { data: { name: 'X' } })).status()).toBe(403)
  await visitor.context().close()
})
