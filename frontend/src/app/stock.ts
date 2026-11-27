// Warehouses, stock balances and stock documents: types and server calls, cached by TanStack Query.
import { infiniteQueryOptions, keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { Key } from './i18n'

export const KINDS = ['receipt', 'write_off', 'transfer'] as const
export type Kind = (typeof KINDS)[number]
export const KIND_LABEL: Record<Kind, Key> = { receipt: 'kindReceipt', write_off: 'kindWriteOff', transfer: 'kindTransfer' }

export type Warehouse = { id: number; name: string; is_default: boolean; archived: boolean }
export type StockRow = {
  product_id: number
  name: string
  sku: string | null
  unit: string
  quantities: Record<string, string> // warehouse id -> quantity
  total: string
  min_stock: string | null
}
export type DocumentRow = {
  id: number
  kind: Kind
  number: number
  date: string
  warehouse_id: number
  to_warehouse_id: number | null
  currency: string | null
  // a receipt from a supplier is a purchase: its total is what we owe for it
  supplier_id: number | null
  supplier_name: string | null
  total: string | null
  cancelled: boolean
  lines: number
}
export type Line = { id: number; product_id: number; product_name: string; unit: string; quantity: string; price: string | null }
export type Negative = { product_id: number; product_name: string; warehouse_id: number; quantity: string }
export type StockDocument = Omit<DocumentRow, 'lines'> & {
  exchange_rate: string | null
  note: string | null
  created_at: string
  lines: Line[]
  negative: Negative[]
}
export type DocumentFields = {
  kind: Kind
  date: string
  warehouse_id: number
  to_warehouse_id: number | null
  currency: string | null
  supplier_id: number | null
  note: string
  lines: { product_id: number; quantity: string; price: string | null }[]
}
export type Show = 'all' | 'positive' | 'negative' | 'low'
export type CountDoc = { id: number; kind: Kind; number: number }
export type CountFields = { warehouse_id: number; note: string; lines: { product_id: number; expected: string; counted: string }[] }

const PAGE = 50
const nextPage = <P extends { items: unknown[]; total: number }>(last: P, pages: P[]) => {
  const loaded = pages.reduce((n, p) => n + p.items.length, 0)
  return loaded < last.total ? loaded : undefined
}

export const warehousesQuery = queryOptions({
  queryKey: ['warehouses'],
  queryFn: () => api<Warehouse[]>('/warehouses'),
})

export const stockList = (q: string, warehouseId: number | undefined, show: Show) =>
  infiniteQueryOptions({
    queryKey: ['stock', 'list', { q, warehouseId, show }],
    queryFn: ({ pageParam }) =>
      api<{ items: StockRow[]; total: number }>(
        `/stock?${new URLSearchParams({
          q,
          show,
          limit: String(PAGE),
          offset: String(pageParam),
          ...(warehouseId ? { warehouse_id: String(warehouseId) } : {}),
        })}`,
      ),
    initialPageParam: 0,
    getNextPageParam: nextPage,
    placeholderData: keepPreviousData,
  })

// Every active product with what one warehouse holds, for a stock count: all of them, page by page.
export const countSheet = (warehouseId: number) =>
  queryOptions({
    queryKey: ['stock', 'count', warehouseId],
    queryFn: async () => {
      const rows: StockRow[] = []
      for (;;) {
        const page = await api<{ items: StockRow[]; total: number }>(
          `/stock?${new URLSearchParams({ warehouse_id: String(warehouseId), limit: '200', offset: String(rows.length) })}`,
        )
        rows.push(...page.items)
        if (rows.length >= page.total || page.items.length === 0) return rows
      }
    },
  })

export const documentList = (kind: Kind | undefined) =>
  infiniteQueryOptions({
    queryKey: ['stock', 'documents', { kind }],
    queryFn: ({ pageParam }) =>
      api<{ items: DocumentRow[]; total: number }>(
        `/stock-documents?${new URLSearchParams({ limit: String(PAGE), offset: String(pageParam), ...(kind ? { kind } : {}) })}`,
      ),
    initialPageParam: 0,
    getNextPageParam: nextPage,
    placeholderData: keepPreviousData,
  })

export const documentQuery = (id: number) =>
  queryOptions({ queryKey: ['stock', 'document', id], queryFn: () => api<StockDocument>(`/stock-documents/${id}`) })

// What each chosen product has in each warehouse now, for a document being filled in.
export const balancesQuery = (productIds: number[]) =>
  queryOptions({
    queryKey: ['stock', 'balances', productIds],
    queryFn: () =>
      api<Record<string, Record<string, string>>>(
        `/stock/balances?${new URLSearchParams(productIds.map((id) => ['product_id', String(id)]))}`,
      ),
    enabled: productIds.length > 0,
    placeholderData: keepPreviousData,
  })

export function useStockMutations() {
  const qc = useQueryClient()
  // a purchase also changes what we owe its supplier
  const refresh = () => (qc.invalidateQueries({ queryKey: ['suppliers'] }), qc.invalidateQueries({ queryKey: ['stock'] }))
  return {
    saveWarehouse: useMutation({
      mutationFn: ({ id, ...f }: { id?: number; name?: string; is_default?: true; archived?: boolean }) =>
        id ? api<Warehouse>(`/warehouses/${id}`, f, 'PATCH') : api<Warehouse>('/warehouses', f),
      onSuccess: () => qc.invalidateQueries({ queryKey: warehousesQuery.queryKey }),
    }),
    createDocument: useMutation({
      mutationFn: (f: DocumentFields) => api<StockDocument>('/stock-documents', f),
      onSuccess: refresh,
    }),
    // the differences become a receipt and a write-off; 409 when stock moved since it was shown
    count: useMutation({
      mutationFn: (f: CountFields) => api<{ documents: CountDoc[] }>('/stock-counts', f),
      onSuccess: refresh,
    }),
    cancelDocument: useMutation({
      mutationFn: (id: number) => api<StockDocument>(`/stock-documents/${id}/cancel`, {}),
      onSuccess: refresh,
    }),
  }
}
