// Suppliers, what we owe them and what we paid them: types and server calls, cached by TanStack Query.
import { infiniteQueryOptions, keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { Method } from './debts'
import type { DocumentRow } from './stock'

export type Owed = { currency: string; owed: string } // negative when we paid ahead
export type Supplier = {
  id: number
  name: string
  inn: string | null
  phone: string | null
  address: string | null
  note: string | null
  archived: boolean
  created_at: string
  balances: Owed[] // empty for those who may not see money
}
export type SupplierFields = { name: string; inn: string; phone: string; address: string; note: string }
export type SupplierPayment = {
  id: number
  number: number
  date: string
  supplier_id: number
  supplier_name: string
  amount: string
  currency: string
  exchange_rate: string | null
  method: Method
  note: string | null
  cancelled_at: string | null
}
export type PayFields = { supplier_id: number; amount: string; currency: string; method: Method; date: string; note: string }
type Page = { items: Supplier[]; total: number; owed: Owed[] }

const PAGE = 50

export const supplierList = (q: string, archived: boolean, owed: boolean) =>
  infiniteQueryOptions({
    queryKey: ['suppliers', 'list', { q, archived, owed }],
    queryFn: ({ pageParam }) =>
      api<Page>(`/suppliers?${new URLSearchParams({ q, archived: String(archived), owed: String(owed), limit: String(PAGE), offset: String(pageParam) })}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    // keep the old rows on screen while a new search loads, so the list doesn't blink per keystroke
    placeholderData: keepPreviousData,
  })

// for pickers: the first matches for what was typed, active suppliers only
export const searchSuppliers = (q: string, limit: number) =>
  api<Page>(`/suppliers?${new URLSearchParams({ q, limit: String(limit) })}`).then((r) => r.items)

export const supplierQuery = (id: number) =>
  queryOptions({ queryKey: ['suppliers', 'one', id], queryFn: () => api<Supplier>(`/suppliers/${id}`), enabled: id > 0 })

// shortcut: a supplier's page shows its latest 50 arrivals and 50 payments; page them when one has more
export const supplierArrivals = (id: number) =>
  queryOptions({
    queryKey: ['suppliers', 'arrivals', id],
    queryFn: () => api<{ items: DocumentRow[]; total: number }>(`/stock-documents?${new URLSearchParams({ supplier_id: String(id), limit: String(PAGE) })}`),
  })

export const supplierPayments = (id: number) =>
  queryOptions({
    queryKey: ['suppliers', 'payments', id],
    queryFn: () => api<{ items: SupplierPayment[]; total: number }>(`/supplier-payments?${new URLSearchParams({ supplier_id: String(id), limit: String(PAGE) })}`),
  })

// Every change moves what we owe, which lists and pages show: refetch all of it.
export function useSupplierMutations() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['suppliers'] })
  return {
    create: useMutation({ mutationFn: (f: SupplierFields) => api<Supplier>('/suppliers', f), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, ...patch }: Partial<SupplierFields> & { id: number; archived?: boolean }) => api<Supplier>(`/suppliers/${id}`, patch, 'PATCH'),
      onSuccess: refresh,
    }),
    pay: useMutation({ mutationFn: (f: PayFields) => api<SupplierPayment>('/supplier-payments', f), onSuccess: refresh }),
    cancelPayment: useMutation({ mutationFn: (id: number) => api<SupplierPayment>(`/supplier-payments/${id}/cancel`, {}), onSuccess: refresh }),
  }
}
