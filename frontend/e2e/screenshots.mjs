// Takes the README's screenshots. Run by scripts/screenshots.sh, which starts the app with a
// freshly seeded demo company: node e2e/screenshots.mjs <app address> <folder>
import { chromium } from '@playwright/test'

const [app, out] = process.argv.slice(2)
const browser = await chromium.launch()
// twice the pixels, so the pictures stay sharp on the screens most people read GitHub on
const page = await browser.newPage({
  baseURL: app,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  timezoneId: 'Asia/Tashkent',
})

const login = await page.request.post('/api/v1/auth/login', {
  data: { login: 'demo', password: process.env.DEMO_PASSWORD ?? 'demo-12345' },
})
if (!login.ok()) throw new Error(`demo login: ${login.status()}`)
const orders = await (await page.request.get('/api/v1/orders?status=confirmed&limit=1')).json()

async function shot(name, path, look = 'glass') {
  // the look, language and open sidebar are what the app remembers in the browser
  await page.addInitScript(l => {
    localStorage.setItem('look', l)
    localStorage.setItem('lang', 'uz')
    localStorage.setItem('dock', 'open')
  }, look)
  await page.goto(path, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  // entrance animations finish
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 82 })
  console.log(`${name}.jpg`)
}

await shot('dashboard', '/')
await shot('order', `/orders/${orders.items[0].id}`)
await shot('debts', '/debts')
await shot('tasks', '/tasks')
await shot('customers-light', '/customers', 'light')
await browser.close()
