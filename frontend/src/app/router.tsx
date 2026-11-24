// The app's addresses. Logged-out visitors get the login screen at any address; after login they
// stay on the page they asked for.
import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet } from '@tanstack/react-router'
import Gate from './Gate'
import Dashboard from './pages/home/Dashboard'
import CustomerDetail from './pages/customers/CustomerDetail'
import CustomerList from './pages/customers/CustomerList'
import Debts, { type DebtSearch } from './pages/debts/Debts'
import Payments from './pages/debts/Payments'
import StatementPage, { type StatementSearch } from './pages/debts/StatementPage'
import NotFound from './pages/NotFound'
import Staff from './pages/staff/Staff'
import Tasks from './pages/tasks/Tasks'
import OrderList from './pages/orders/OrderList'
import { ExistingOrder, NewOrder } from './pages/orders/OrderPage'
import ReturnPage from './pages/orders/ReturnPage'
import ProductList from './pages/products/ProductList'
import ProductPage from './pages/products/ProductPage'
import Balances from './pages/stock/Balances'
import DocumentView from './pages/stock/DocumentView'
import Documents from './pages/stock/Documents'
import NewDocument from './pages/stock/NewDocument'
import { METHODS, type Method } from './debts'
import { STATUSES, type Status } from './orders'
import { PRIORITIES, type Priority } from './tasks'
import { KINDS, type Kind, type Show } from './stock'

// unknown addresses get the same login-or-app frame, with the not-found message as the page
const root = createRootRoute({
  component: Outlet,
  notFoundComponent: () => (
    <Gate>
      <NotFound />
    </Gate>
  ),
})
const app = createRoute({ getParentRoute: () => root, id: 'app', component: Gate })
// the owner's overview
const home = createRoute({ getParentRoute: () => app, path: '/', component: Dashboard })
const customers = createRoute({
  getParentRoute: () => app,
  path: '/customers',
  component: CustomerList,
  // ?q=...&archived=true; anything else in the address is ignored
  validateSearch: (s: Record<string, unknown>): { q?: string; archived?: true; sort?: string } => ({
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    archived: s.archived === true || s.archived === 'true' ? true : undefined,
    sort: sortOf(s.sort, ['name', 'created', 'last_order']),
  }),
})
const products = createRoute({
  getParentRoute: () => app,
  path: '/products',
  component: ProductList,
  // ?q=...&category=12&archived=true&sort=-stock
  validateSearch: (s: Record<string, unknown>): { q?: string; category?: number; archived?: true; sort?: string } => {
    const category = Number(s.category)
    return {
      q: typeof s.q === 'string' && s.q ? s.q : undefined,
      category: Number.isInteger(category) && category > 0 ? category : undefined,
      archived: s.archived === true || s.archived === 'true' ? true : undefined,
      sort: sortOf(s.sort, ['name', 'sku', 'stock']),
    }
  },
})
const positive = (v: unknown) => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : undefined
}
const isoDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
// "field" or "-field", for one of the list's sortable fields
const sortOf = (v: unknown, fields: string[]) => (typeof v === 'string' && fields.includes(v.replace(/^-/, '')) ? v : undefined)
const kindOf = (v: unknown) => (KINDS.includes(v as Kind) ? (v as Kind) : undefined)
// ?q=...&warehouse=3&show=negative
const stock = createRoute({
  getParentRoute: () => app,
  path: '/stock',
  component: Balances,
  validateSearch: (s: Record<string, unknown>): { q?: string; warehouse?: number; show?: Show } => ({
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    warehouse: positive(s.warehouse),
    show: s.show === 'positive' || s.show === 'negative' || s.show === 'low' ? s.show : undefined,
  }),
})
const stockDocuments = createRoute({
  getParentRoute: () => app,
  path: '/stock/documents',
  component: Documents,
  validateSearch: (s: Record<string, unknown>): { kind?: Kind } => ({ kind: kindOf(s.kind) }),
})
const newStockDocument = createRoute({
  getParentRoute: () => app,
  path: '/stock/documents/new',
  component: NewDocument,
  validateSearch: (s: Record<string, unknown>): { kind: Kind } => ({ kind: kindOf(s.kind) ?? 'receipt' }),
})
const stockDocument = createRoute({ getParentRoute: () => app, path: '/stock/documents/$documentId', component: DocumentView })
// ?q=...&status=draft&from=2026-11-01&to=2026-11-19&payment=unpaid&sort=-total
const orders = createRoute({
  getParentRoute: () => app,
  path: '/orders',
  component: OrderList,
  validateSearch: (s: Record<string, unknown>): { q?: string; status?: Status; from?: string; to?: string; payment?: 'unpaid' | 'overdue'; sort?: string } => ({
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    status: STATUSES.includes(s.status as Status) ? (s.status as Status) : undefined,
    from: isoDate(s.from),
    to: isoDate(s.to),
    payment: s.payment === 'unpaid' || s.payment === 'overdue' ? s.payment : undefined,
    sort: sortOf(s.sort, ['date', 'number', 'customer', 'total', 'due']),
  }),
})
const newOrder = createRoute({
  getParentRoute: () => app,
  path: '/orders/new',
  component: NewOrder,
  // ?customer=12: start the order for this customer
  validateSearch: (s: Record<string, unknown>): { customer?: number } => ({ customer: positive(s.customer) }),
})
const order = createRoute({ getParentRoute: () => app, path: '/orders/$orderId', component: ExistingOrder })
const salesReturn = createRoute({ getParentRoute: () => app, path: '/returns/$returnId', component: ReturnPage })
const product = createRoute({ getParentRoute: () => app, path: '/products/$productId', component: ProductPage })
const staff = createRoute({ getParentRoute: () => app, path: '/staff', component: Staff })
const customer = createRoute({ getParentRoute: () => app, path: '/customers/$customerId', component: CustomerDetail })
// ?currency=USD&from=2026-01-01&to=2026-11-19
const statement = createRoute({
  getParentRoute: () => app,
  path: '/customers/$customerId/statement',
  component: StatementPage,
  validateSearch: (s: Record<string, unknown>): StatementSearch => ({
    currency: typeof s.currency === 'string' && /^[A-Z]{3}$/.test(s.currency) ? s.currency : undefined,
    from: isoDate(s.from),
    to: isoDate(s.to),
  }),
})
// ?q=...&overdue=true&sort=late
const debts = createRoute({
  getParentRoute: () => app,
  path: '/debts',
  component: Debts,
  validateSearch: (s: Record<string, unknown>): DebtSearch => ({
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    overdue: s.overdue === true || s.overdue === 'true' ? true : undefined,
    sort: s.sort === 'late' ? 'late' : undefined,
  }),
})
// ?view=list|done (the board when left out)&q=&priority=urgent&due=overdue
const tasks = createRoute({
  getParentRoute: () => app,
  path: '/tasks',
  component: Tasks,
  validateSearch: (s: Record<string, unknown>): { view?: 'list' | 'done'; q?: string; priority?: Priority; due?: 'overdue' | 'today' | 'week'; mine?: true } => ({
    mine: s.mine === true || s.mine === 'true' ? true : undefined,
    view: s.view === 'list' || s.view === 'done' ? s.view : undefined,
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    priority: PRIORITIES.includes(s.priority as Priority) ? (s.priority as Priority) : undefined,
    due: s.due === 'overdue' || s.due === 'today' || s.due === 'week' ? s.due : undefined,
  }),
})
// ?q=...&from=&to=&method=cash&sort=-amount
const payments = createRoute({
  getParentRoute: () => app,
  path: '/payments',
  component: Payments,
  validateSearch: (s: Record<string, unknown>): { q?: string; from?: string; to?: string; method?: Method; sort?: string } => ({
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    from: isoDate(s.from),
    to: isoDate(s.to),
    method: METHODS.includes(s.method as Method) ? (s.method as Method) : undefined,
    sort: sortOf(s.sort, ['date', 'number', 'customer', 'amount']),
  }),
})

// The design prototype, kept for reference while building real screens. Development builds only.
const prototype = createRoute({
  getParentRoute: () => root,
  path: '/prototype',
  component: lazyRouteComponent(() => import('./pages/Prototype')),
})

const tree = root.addChildren([app.addChildren([home, orders, newOrder, order, salesReturn, debts, payments, tasks, customers, customer, statement, products, product, stock, stockDocuments, newStockDocument, stockDocument, staff]), ...(import.meta.env.DEV ? [prototype] : [])])

// 'root': unknown addresses always use the root's not-found page, which keeps the login-or-app frame
export const router = createRouter({ routeTree: tree, notFoundMode: 'root' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
