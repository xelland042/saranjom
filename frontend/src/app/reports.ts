// Reports over a period. The sales report: what was sold, to whom and by whom, in the company's
// own currency; cost and profit come only for people who see money (null otherwise).
import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import { api } from './api'

export const REPORT_BY = ['product', 'customer', 'manager'] as const
export type ReportBy = (typeof REPORT_BY)[number]
export type SalesRow = {
  id: number | null // null: orders entered by someone since removed
  name: string | null
  unit: string | null // by product only
  orders: number
  quantity: string
  sales: string
  cost: string | null
  profit: string | null
  uncosted: string | null // the part of `sales` whose cost isn't known, so it counts as all profit
}
export type SalesReport = { currency: string; items: SalesRow[]; sales: string; cost: string | null; profit: string | null }
export type SalesReportFilters = { by: ReportBy; date_from: string; date_to: string; sort: string }

export const salesReport = (f: SalesReportFilters) =>
  queryOptions({
    queryKey: ['reports', 'sales', f],
    queryFn: () => api<SalesReport>(`/reports/sales?${new URLSearchParams(f)}`),
    placeholderData: keepPreviousData,
  })
