// The owner's overview: one request for the home page.
import { queryOptions } from '@tanstack/react-query'
import { api } from './api'
import type { Debt, DebtTotal } from './debts'
import type { OrderRow } from './orders'
import type { Task } from './tasks'

export type Dashboard = {
  currency: string // sales and money received are in it; other currencies at their saved rate
  sales: { today: string; month: string; prev_month: string; orders_today: number; drafts: number }
  received: { today: string; month: string }
  daily: { date: string; total: string }[] // the last 30 days
  debts: { totals: DebtTotal[]; top: Debt[]; overdue_customers: number }
  tasks: { overdue: number; today: number; items: Task[] }
  stock: { negative: number; low: number; items: { product_id: number; name: string; unit: string; stock: string; min_stock: string | null }[] }
  recent: OrderRow[]
}

export const dashboardQuery = queryOptions({
  queryKey: ['dashboard'],
  queryFn: () => api<Dashboard>('/dashboard'),
  // an open dashboard stays roughly current while people work elsewhere
  refetchInterval: 5 * 60_000,
})
