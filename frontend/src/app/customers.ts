// Customers and their contacts: types and server calls, cached by TanStack Query.
import { infiniteQueryOptions, keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export type CustomerRow = {
  id: number
  name: string
  inn: string | null
  phone: string | null
  address: string | null
  archived: boolean
  price_list_id: number | null
  payment_days: number | null
  credit_limit: string | null
  credit_currency: string | null
}
export type Contact = { id: number; name: string; phone: string | null; position: string | null }
export type Customer = CustomerRow & {
  note: string | null
  created_at: string
  updated_at: string
  contacts: Contact[]
}
export type CustomerFields = {
  name: string
  inn: string
  phone: string
  address: string
  note: string
  price_list_id: number | null
  payment_days: number | null
  credit_limit: string | null
  credit_currency: string | null
}
export type ContactFields = { name: string; phone: string; position: string }
export type CustomerListRow = CustomerRow & {
  last_order: string | null
  // what they owe per currency (negative: paid ahead), zero ones left out
  balances: { currency: string; balance: string; overdue: string }[]
}
type Page = { items: CustomerListRow[]; total: number }

const PAGE = 50

export const customerList = (q: string, archived: boolean, sort = 'name') =>
  infiniteQueryOptions({
    queryKey: ['customers', 'list', { q, archived, sort }],
    queryFn: ({ pageParam }) =>
      api<Page>(`/customers?${new URLSearchParams({ q, archived: String(archived), sort, limit: String(PAGE), offset: String(pageParam) })}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    // keep the old rows on screen while a new search loads, so the list doesn't blink per keystroke
    placeholderData: keepPreviousData,
  })

export const similarCustomers = (name: string, exclude?: number) =>
  queryOptions({
    queryKey: ['customers', 'similar', { name, exclude }],
    queryFn: () =>
      api<CustomerRow[]>(`/customers/similar?${new URLSearchParams({ name, ...(exclude ? { exclude: String(exclude) } : {}) })}`),
    enabled: name.trim().length >= 3,
    staleTime: 30_000,
  })

// for pickers: the first matches for what was typed, active customers only
export const searchCustomers = (q: string, limit: number) =>
  api<Page>(`/customers?${new URLSearchParams({ q, limit: String(limit) })}`).then((r) => r.items)

export const customerQuery = (id: number) =>
  queryOptions({ queryKey: ['customers', 'one', id], queryFn: () => api<Customer>(`/customers/${id}`) })

// Every change returns the fresh customer (or contact); cache it and let the lists refetch.
export function useCustomerMutations() {
  const qc = useQueryClient()
  const refreshLists = () => qc.invalidateQueries({ queryKey: ['customers', 'list'] })
  const store = (c: Customer) => {
    qc.setQueryData(customerQuery(c.id).queryKey, c)
    refreshLists()
    return c
  }
  const refreshOne = (id: number) => qc.invalidateQueries({ queryKey: customerQuery(id).queryKey })

  return {
    create: useMutation({
      mutationFn: (f: CustomerFields) => api<Customer>('/customers', f),
      onSuccess: store,
    }),
    update: useMutation({
      mutationFn: ({ id, ...patch }: Partial<CustomerFields> & { id: number; archived?: boolean }) =>
        api<Customer>(`/customers/${id}`, patch, 'PATCH'),
      onSuccess: store,
    }),
    saveContact: useMutation({
      mutationFn: ({ customerId, id, ...f }: ContactFields & { customerId: number; id?: number }) =>
        id
          ? api<Contact>(`/customers/${customerId}/contacts/${id}`, f, 'PATCH')
          : api<Contact>(`/customers/${customerId}/contacts`, f),
      onSuccess: (_, v) => refreshOne(v.customerId),
    }),
    deleteContact: useMutation({
      mutationFn: ({ customerId, id }: { customerId: number; id: number }) =>
        api<void>(`/customers/${customerId}/contacts/${id}`, undefined, 'DELETE'),
      onSuccess: (_, v) => refreshOne(v.customerId),
    }),
  }
}
