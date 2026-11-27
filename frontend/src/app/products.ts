// Products, their categories and price lists: types and server calls, cached by TanStack Query.
import { infiniteQueryOptions, keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { currencyLabel, formatAmount } from './money'
import { usePrefs } from './prefs'

export const UNITS = ['pcs', 'kg', 'g', 't', 'l', 'm', 'm2', 'm3', 'box', 'pack', 'bag', 'set', 'roll'] as const
export type Unit = (typeof UNITS)[number]

export type Price = { price_list_id: number; amount: string }
export type Product = {
  id: number
  name: string
  sku: string | null
  barcode: string | null
  unit: Unit
  category_id: number | null
  mxik: string | null
  note: string | null
  min_stock: string | null // below this in all warehouses together: running low
  cost: string | null // per unit, in the company's currency: for goods that arrived without a price
  archived: boolean
  updated_at: string
  prices: Price[]
}
// in the list: with its stock in all warehouses together
export type ProductRow = Product & { stock: string; low: boolean }
// one posted change of its stock, newest first
export type Movement = {
  date: string
  kind: 'receipt' | 'write_off' | 'transfer' | 'sale' | 'return'
  id: number
  number: number
  warehouse_id: number
  to_warehouse_id: number | null
  quantity: string
  customer_name: string | null
}
export type Category = { id: number; name: string; products: number }
export type PriceList = { id: number; name: string; currency: string; is_default: boolean; archived: boolean }
export type ProductFields = {
  name: string
  sku: string
  barcode: string
  unit: Unit
  category_id: number | null
  mxik: string
  note: string
  min_stock: string | null
  cost: string | null
  // null removes the price in that list
  prices: { price_list_id: number; amount: string | null }[]
}
type Page = { items: ProductRow[]; total: number }

const PAGE = 50

export const productList = (q: string, categoryId: number | undefined, archived: boolean, sort = 'name') =>
  infiniteQueryOptions({
    queryKey: ['products', 'list', { q, categoryId, archived, sort }],
    queryFn: ({ pageParam }) =>
      api<Page>(
        `/products?${new URLSearchParams({
          q,
          archived: String(archived),
          sort,
          limit: String(PAGE),
          offset: String(pageParam),
          ...(categoryId ? { category_id: String(categoryId) } : {}),
        })}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
    placeholderData: keepPreviousData,
  })

export const productQuery = (id: number) => queryOptions({ queryKey: ['products', 'one', id], queryFn: () => api<Product>(`/products/${id}`) })

export const movementsQuery = (id: number) =>
  queryOptions({ queryKey: ['products', 'movements', id], queryFn: () => api<Movement[]>(`/products/${id}/movements?limit=100`) })

export const categoriesQuery = queryOptions({
  queryKey: ['products', 'categories'],
  queryFn: () => api<Category[]>('/product-categories'),
})

export const priceListsQuery = queryOptions({
  queryKey: ['price-lists'],
  queryFn: () => api<PriceList[]>('/price-lists'),
})

export type Rate = { currency: string; rate: string | null; source: 'company' | 'cbu' | null; cbu_rate: string | null; cbu_date: string | null }
export const ratesQuery = queryOptions({
  queryKey: ['exchange-rates'],
  queryFn: () => api<{ base: string; rates: Rate[] }>('/exchange-rates'),
  staleTime: 10 * 60_000,
})

// "≈ 354 300 soʻm" for a price in another currency, or null when it's already in the main currency
// or no rate is known. A hint only: prices themselves are never converted.
export function useEquivalent() {
  const { lang } = usePrefs()
  const rates = useQuery(ratesQuery).data
  return (amount: string, currency: string) => {
    const rate = rates?.rates.find((r) => r.currency === currency)?.rate
    if (!rates || currency === rates.base || !rate) return null
    // shortcut: float maths, fine for a rounded hint; use decimals if this ever becomes a real amount
    const value = Math.round(Number(amount) * Number(rate))
    return `≈ ${formatAmount(String(value))} ${currencyLabel(rates.base, lang)}`
  }
}

export function useProductMutations() {
  const qc = useQueryClient()
  // a product change also changes category counts, so refresh everything under 'products'
  const refresh = () => qc.invalidateQueries({ queryKey: ['products'] })
  const refreshLists = () => qc.invalidateQueries({ queryKey: priceListsQuery.queryKey })
  const refreshRates = () => qc.invalidateQueries({ queryKey: ratesQuery.queryKey })
  return {
    setRate: useMutation({
      mutationFn: ({ currency, rate }: { currency: string; rate: string | null }) =>
        rate === null
          ? api<void>(`/exchange-rates/${currency}`, undefined, 'DELETE')
          : api<void>(`/exchange-rates/${currency}`, { rate }, 'PUT'),
      onSuccess: refreshRates,
    }),
    save: useMutation({
      mutationFn: ({ id, ...f }: Partial<ProductFields> & { id?: number; archived?: boolean }) =>
        id ? api<Product>(`/products/${id}`, f, 'PATCH') : api<Product>('/products', f),
      onSuccess: refresh,
    }),
    saveCategory: useMutation({
      mutationFn: ({ id, name }: { id?: number; name: string }) =>
        id ? api<Category>(`/product-categories/${id}`, { name }, 'PATCH') : api<Category>('/product-categories', { name }),
      onSuccess: refresh,
    }),
    deleteCategory: useMutation({
      mutationFn: (id: number) => api<void>(`/product-categories/${id}`, undefined, 'DELETE'),
      onSuccess: refresh,
    }),
    savePriceList: useMutation({
      mutationFn: ({ id, ...f }: { id?: number; name?: string; currency?: string; is_default?: true; archived?: boolean }) =>
        id ? api<PriceList>(`/price-lists/${id}`, f, 'PATCH') : api<PriceList>('/price-lists', f),
      // a new list may bring a new currency, which needs a rate
      onSuccess: () => Promise.all([refreshLists(), refreshRates()]),
    }),
  }
}
