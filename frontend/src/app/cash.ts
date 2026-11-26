// The cash box and the bank: what is in each, every movement of money, and the ones that are
// nobody's payment (expenses, other money in, transfers). Types and server calls.
import { infiniteQueryOptions, keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { Key } from './i18n'
import { filterParams } from './orders'

export const PLACES = ['cash', 'bank'] as const
export type Place = (typeof PLACES)[number]
export const PLACE_LABEL: Record<Place, Key> = { cash: 'placeCash', bank: 'placeBank' }

// what a line of the list is; only the last three are entered here
export const MONEY_KINDS = ['payment', 'payout', 'expense', 'income', 'transfer'] as const
export type MoneyKind = (typeof MONEY_KINDS)[number]
export type MoveKind = 'expense' | 'income' | 'transfer'
export const KIND_LABEL: Record<MoneyKind, Key> = { payment: 'moneyPayment', payout: 'moneyPayout', expense: 'moneyExpense', income: 'moneyIncome', transfer: 'moneyTransfer' }

// the server's lists (app/models/money.py): the last of each is money that isn't earned or spent
export const EXPENSES = ['rent', 'salary', 'transport', 'utilities', 'taxes', 'bank_fee', 'marketing', 'other', 'owner_out'] as const
export const INCOMES = ['opening', 'owner_in', 'other'] as const
export type Category = (typeof EXPENSES)[number] | (typeof INCOMES)[number]
export const CATEGORY_LABEL: Record<Category, Key> = {
  rent: 'catRent',
  salary: 'catSalary',
  transport: 'catTransport',
  utilities: 'catUtilities',
  taxes: 'catTaxes',
  bank_fee: 'catBankFee',
  marketing: 'catMarketing',
  other: 'catOther',
  owner_out: 'catOwnerOut',
  opening: 'catOpening',
  owner_in: 'catOwnerIn',
}

export type MoneyRow = {
  source: 'payment' | 'supplier_payment' | 'money_move' // whose id this is
  id: number
  number: number
  date: string
  kind: MoneyKind
  place: Place
  currency: string
  amount: string // signed: money in is positive
  category: Category | null
  party: string | null // the customer or the supplier
  party_id: number | null
  other_place: Place | null // a transfer's other end
  other_currency: string | null
  note: string | null
  cancelled_at: string | null
}
export type Balance = { place: Place; currency: string; amount: string }
export type Flow = { currency: string; incoming: string; outgoing: string }
export type MoneyFilters = { place?: Place; kind?: MoneyKind; date_from?: string; date_to?: string }
export type MoveFields = {
  kind: MoveKind
  place: Place
  currency: string
  amount: string
  category?: Category
  to_place?: Place
  to_currency?: string
  received?: string
  date: string
  note: string
}
type Page = { items: MoneyRow[]; total: number; sums: Flow[]; balances: Balance[] }

export const moneyList = (f: MoneyFilters) =>
  infiniteQueryOptions({
    queryKey: ['cash', 'list', f],
    queryFn: ({ pageParam }) => api<Page>(`/money?${new URLSearchParams({ ...filterParams(f), limit: '50', offset: String(pageParam) })}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    placeholderData: keepPreviousData,
  })

// What the company earned in a period, in its own currency: sales less what the sold goods cost
// less expenses. `uncosted`: products sold that were never received at a price (their cost counts
// as zero, so the profit shows too high).
export type Profit = {
  currency: string
  sales: string
  cost: string
  gross: string
  expenses: { category: Category; amount: string }[]
  expenses_total: string
  other_income: string
  profit: string
  uncosted: { count: number; sales: string; products: { id: number; name: string; sales: string }[] }
}
export const profitQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['cash', 'profit', from, to],
    queryFn: () => api<Profit>(`/profit?${new URLSearchParams({ date_from: from, date_to: to })}`),
    placeholderData: keepPreviousData,
  })

// the list itself is refreshed after every change anywhere (main.tsx): a payment moves it too
export function useMoneyMutations() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['cash'] })
  return {
    add: useMutation({ mutationFn: (f: MoveFields) => api<{ id: number }>('/money-moves', f), onSuccess: refresh }),
    cancel: useMutation({ mutationFn: (id: number) => api<{ id: number }>(`/money-moves/${id}/cancel`, {}), onSuccess: refresh }),
  }
}
