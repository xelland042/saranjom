// Payments, debts, opening debts and the customer statement (akt sverki): types and server calls.
import { infiniteQueryOptions, keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { Key } from './i18n'
import { filterParams } from './orders'

export const METHODS = ['cash', 'transfer', 'card', 'online'] as const
export type Method = (typeof METHODS)[number]
export const METHOD_LABEL: Record<Method, Key> = { cash: 'methodCash', transfer: 'methodTransfer', card: 'methodCard', online: 'methodOnline' }

export type Payment = {
  id: number
  number: number
  date: string
  customer_id: number
  customer_name: string
  amount: string
  currency: string
  exchange_rate: string | null
  method: Method
  note: string | null
  created_at: string
  cancelled_at: string | null
}
export type PaymentFields = { customer_id: number; amount: string; currency: string; method: Method; date: string; note: string }

// a customer's balance in one currency: positive means they owe the company
export type Debt = {
  customer_id: number
  customer_name: string
  currency: string
  balance: string
  overdue: string
  late_since: string | null
  last_payment: string | null
}
export type DebtTotal = { currency: string; owed: string; overdue: string }
export type Balance = Debt & { opening: { amount: string; date: string } | null }
export type StatementRow = { date: string; kind: 'opening' | 'order' | 'payment' | 'return'; id: number; number: number | null; debit: string; credit: string; balance: string }
export type Statement = {
  customer_id: number
  customer_name: string
  currency: string
  date_from: string | null
  date_to: string
  opening: string
  rows: StatementRow[]
  debit: string
  credit: string
  closing: string
}
export type DebtSort = 'balance' | 'late'

const nextOffset = <P extends { items: unknown[]; total: number }>(last: P, pages: P[]) => {
  const loaded = pages.reduce((n, p) => n + p.items.length, 0)
  return loaded < last.total ? loaded : undefined
}

export const debtList = (q: string, overdue: boolean, sort: DebtSort) =>
  infiniteQueryOptions({
    queryKey: ['debts', 'list', { q, overdue, sort }],
    queryFn: ({ pageParam }) =>
      api<{ items: Debt[]; total: number; totals: DebtTotal[] }>(
        `/debts?${new URLSearchParams({ q, sort, overdue: String(overdue), limit: '50', offset: String(pageParam) })}`,
      ),
    initialPageParam: 0,
    getNextPageParam: nextOffset,
    placeholderData: keepPreviousData,
  })

export type PaymentFilters = { q?: string; customer_id?: number; date_from?: string; date_to?: string; method?: Method; sort?: string }

export const paymentList = (f: PaymentFilters) =>
  infiniteQueryOptions({
    queryKey: ['payments', 'list', f],
    queryFn: ({ pageParam }) =>
      api<{ items: Payment[]; total: number; sums: { currency: string; amount: string }[] }>(
        `/payments?${new URLSearchParams({ ...filterParams(f), limit: '50', offset: String(pageParam) })}`,
      ),
    initialPageParam: 0,
    getNextPageParam: nextOffset,
    placeholderData: keepPreviousData,
  })

export const customerBalancesQuery = (customerId: number) =>
  queryOptions({ queryKey: ['debts', 'customer', customerId], queryFn: () => api<Balance[]>(`/customers/${customerId}/balances`) })

export const statementQuery = (customerId: number, currency: string, from?: string, to?: string) =>
  queryOptions({
    queryKey: ['debts', 'statement', customerId, { currency, from, to }],
    queryFn: () =>
      api<Statement>(
        `/customers/${customerId}/statement?${new URLSearchParams({ currency, ...(from ? { date_from: from } : {}), ...(to ? { date_to: to } : {}) })}`,
      ),
  })

export function useDebtMutations() {
  const qc = useQueryClient()
  // a payment or opening debt changes every debt view; orders' credit checks read them on the server
  const refresh = () => Promise.all(['debts', 'payments', 'dashboard', 'activity', 'orders', 'customers'].map((key) => qc.invalidateQueries({ queryKey: [key] })))
  return {
    pay: useMutation({ mutationFn: (f: PaymentFields) => api<Payment>('/payments', f), onSuccess: refresh }),
    cancelPayment: useMutation({ mutationFn: (id: number) => api<Payment>(`/payments/${id}/cancel`, {}), onSuccess: refresh }),
    setOpening: useMutation({
      mutationFn: ({ customerId, currency, ...f }: { customerId: number; currency: string; amount: string; date: string }) =>
        api<void>(`/customers/${customerId}/opening-balances/${currency}`, f, 'PUT'),
      onSuccess: refresh,
    }),
    deleteOpening: useMutation({
      mutationFn: ({ customerId, currency }: { customerId: number; currency: string }) =>
        api<void>(`/customers/${customerId}/opening-balances/${currency}`, undefined, 'DELETE'),
      onSuccess: refresh,
    }),
  }
}
