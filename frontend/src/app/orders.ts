// Sales orders, their returns and the company's VAT rates: types and server calls, cached by
// TanStack Query.
import { infiniteQueryOptions, keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { Key } from './i18n'
import type { Negative } from './stock'

export const STATUSES = ['draft', 'confirmed', 'cancelled'] as const
export type Status = (typeof STATUSES)[number]
export const STATUS_LABEL: Record<Status, Key> = { draft: 'statusDraft', confirmed: 'statusConfirmed', cancelled: 'cancelledBadge' }

export type OrderLine = {
  id: number
  product_id: number
  product_name: string
  unit: string
  quantity: string
  price: string
  discount: string
  amount: string
  vat_rate: string
  vat_amount: string
  returned: string // brought back by returns that still count
}
// a return as its order lists it
export type ReturnRow = { id: number; number: number; date: string; total: string; cancelled: boolean }
export type Order = {
  id: number
  number: number
  date: string
  status: Status
  customer_id: number
  customer_name: string
  warehouse_id: number
  price_list_id: number
  currency: string
  exchange_rate: string | null
  total: string
  vat_total: string
  note: string | null
  created_at: string
  confirmed_at: string | null
  due_date: string | null
  unpaid: string | null // what's left to pay, confirmed orders only
  lines: OrderLine[]
  returns: ReturnRow[]
  returned_total: string // of the returns that still count
  negative: Negative[]
  // confirming took the customer's debt above their credit limit (allowed, reported)
  credit: { currency: string; limit: string; debt: string } | null
}
export type OrderRow = Pick<Order, 'id' | 'number' | 'date' | 'status' | 'customer_id' | 'customer_name' | 'currency' | 'total' | 'due_date' | 'unpaid' | 'returned_total'> & {
  lines: number
}
export type OrderSum = { currency: string; total: string; unpaid: string }
export type PaymentFilter = 'unpaid' | 'overdue'
export type OrderFilters = {
  q?: string
  status?: Status
  customer_id?: number
  date_from?: string
  date_to?: string
  payment?: PaymentFilter
  sort?: string
}

// Paid, partly paid, unpaid or overdue: from what's left to pay and the due date. Returns make
// the order smaller, not paid: what's owed is measured against the total less them. A fully
// returned order owes nothing and gets no badge (the server gives it no unpaid part).
export type PayState = 'paid' | 'partial' | 'unpaid' | 'overdue'
export function payState(o: Pick<Order, 'status' | 'total' | 'unpaid' | 'due_date' | 'returned_total'>, today: string): PayState | null {
  if (o.status !== 'confirmed' || o.unpaid === null) return null
  if (Number(o.unpaid) <= 0) return 'paid'
  if (o.due_date && o.due_date < today) return 'overdue'
  return Number(o.unpaid) < Number(o.total) - Number(o.returned_total) ? 'partial' : 'unpaid'
}
export const PAY_LABEL: Record<PayState, Key> = { paid: 'payPaid', partial: 'payPartial', unpaid: 'payUnpaid', overdue: 'payOverdue' }

// filters as the API's query: empty ones left out
export const filterParams = (f: Record<string, string | number | boolean | undefined>) =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== '' && v !== false).map(([k, v]) => [k, String(v)]))
export type OrderFields = {
  customer_id: number
  date: string
  warehouse_id: number
  price_list_id: number
  note: string
  lines: { product_id: number; quantity: string; price: string; discount: string }[]
}
export type VatRate = { id: number; rate: string; valid_from: string }

// Goods a customer brought back from a confirmed order, at the order's own prices
export type ReturnLine = {
  id: number
  order_line_id: number
  product_id: number
  product_name: string
  unit: string
  quantity: string
  price: string
  discount: string
  amount: string
  vat_rate: string
  vat_amount: string
}
export type SalesReturn = {
  id: number
  number: number
  date: string
  order_id: number
  order_number: number
  customer_id: number
  customer_name: string
  warehouse_id: number
  currency: string
  exchange_rate: string | null
  total: string
  vat_total: string
  note: string | null
  created_at: string
  cancelled: boolean
  lines: ReturnLine[]
  negative: Negative[] // cancelling took stock below zero (allowed, reported)
}
export type ReturnFields = { date: string; warehouse_id: number; note: string; lines: { order_line_id: number; quantity: string }[] }
export const returnQuery = (id: number) => queryOptions({ queryKey: ['returns', id], queryFn: () => api<SalesReturn>(`/returns/${id}`) })

export const orderList = (f: OrderFilters) =>
  infiniteQueryOptions({
    queryKey: ['orders', 'list', f],
    queryFn: ({ pageParam }) =>
      api<{ items: OrderRow[]; total: number; sums: OrderSum[] }>(`/orders?${new URLSearchParams({ ...filterParams(f), limit: '50', offset: String(pageParam) })}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    placeholderData: keepPreviousData,
  })

export const orderQuery = (id: number) => queryOptions({ queryKey: ['orders', 'one', id], queryFn: () => api<Order>(`/orders/${id}`) })

export const vatRatesQuery = queryOptions({ queryKey: ['vat-rates'], queryFn: () => api<VatRate[]>('/vat-rates') })

// The VAT rate on a date ("2026-11-19"), from rates newest first; 0 when none applies yet.
export const vatOn = (rates: VatRate[] | undefined, date: string) => Number(rates?.find((r) => r.valid_from <= date)?.rate ?? 0)

export function useOrderMutations() {
  const qc = useQueryClient()
  const store = (o: Order) => {
    qc.setQueryData(orderQuery(o.id).queryKey, o)
    qc.invalidateQueries({ queryKey: ['orders', 'list'] })
    // confirming or cancelling moves stock, the customer's debt, the overview and the history
    for (const key of ['stock', 'debts', 'dashboard', 'activity', 'customers']) qc.invalidateQueries({ queryKey: [key] })
    return o
  }
  const refreshVat = () => qc.invalidateQueries({ queryKey: vatRatesQuery.queryKey })
  // a return moves stock and the debt like a sale does, and shows on its order's page
  const storeReturn = (r: SalesReturn) => {
    qc.setQueryData(returnQuery(r.id).queryKey, r)
    for (const key of ['orders', 'stock', 'products', 'debts', 'dashboard', 'activity', 'customers']) qc.invalidateQueries({ queryKey: [key] })
    return r
  }
  return {
    save: useMutation({
      mutationFn: ({ id, ...f }: OrderFields & { id?: number }) => (id ? api<Order>(`/orders/${id}`, f, 'PUT') : api<Order>('/orders', f)),
      onSuccess: store,
    }),
    confirm: useMutation({ mutationFn: (id: number) => api<Order>(`/orders/${id}/confirm`, {}), onSuccess: store }),
    cancel: useMutation({ mutationFn: (id: number) => api<Order>(`/orders/${id}/cancel`, {}), onSuccess: store }),
    addReturn: useMutation({
      mutationFn: ({ orderId, ...f }: ReturnFields & { orderId: number }) => api<SalesReturn>(`/orders/${orderId}/returns`, f),
      onSuccess: storeReturn,
    }),
    cancelReturn: useMutation({ mutationFn: (id: number) => api<SalesReturn>(`/returns/${id}/cancel`, {}), onSuccess: storeReturn }),
    addVat: useMutation({ mutationFn: (f: { rate: string; valid_from: string }) => api<VatRate>('/vat-rates', f), onSuccess: refreshVat }),
    deleteVat: useMutation({ mutationFn: (id: number) => api<void>(`/vat-rates/${id}`, undefined, 'DELETE'), onSuccess: refreshVat }),
  }
}
