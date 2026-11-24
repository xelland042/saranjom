// Stock balances: every active product with what's in each warehouse. Negative stock (sold or
// written off beyond what was entered) shows in red so it gets fixed. Filters live in the address.
import type { CSSProperties } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { Package, Search, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { Key } from '../../i18n'
import { ExportButton } from '../../ListTools'
import { formatDecimal } from '../../money'
import { EmptyState } from '../../Page'
import { usePrefs } from '../../prefs'
import { stockList, warehousesQuery, type Show } from '../../stock'
import { useSearchBox } from '../../useSearchBox'
import StockHeader from './StockHeader'

const route = getRouteApi('/app/stock')
// per-warehouse columns appear as the screen widens
const COLUMN = ['hidden md:table-cell', 'hidden lg:table-cell', 'hidden xl:table-cell', 'hidden 2xl:table-cell']

export function Qty({ value, unit }: { value: string; unit?: string }) {
  const { t } = usePrefs()
  const n = Number(value)
  return (
    <span className={`tabular-nums ${n < 0 ? 'font-medium text-red' : n === 0 ? 'text-muted-foreground' : ''}`}>
      {formatDecimal(value)}
      {unit && <span className="ml-1 text-xs text-muted-foreground">{t(`unit_${unit}` as Key)}</span>}
    </span>
  )
}

export default function Balances() {
  const { t } = usePrefs()
  const { q = '', warehouse, show = 'all' } = route.useSearch()
  const navigate = route.useNavigate()
  const [text, onType] = useSearchBox(q, (v) => navigate({ search: (s) => ({ ...s, q: v }), replace: true }))
  const warehouses = useQuery(warehousesQuery)
  const active = (warehouses.data ?? []).filter((w) => !w.archived)
  // all warehouses: a column each (as many as fit); one warehouse: just its total
  const columns = warehouse ? [] : active.slice(0, COLUMN.length)
  const list = useInfiniteQuery(stockList(q, warehouse, show))
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const total = list.data?.pages[0]?.total ?? 0

  let body
  if (list.isPending) {
    body = (
      <div className="grid gap-3 p-4" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 rounded-xl" />
        ))}
      </div>
    )
  } else if (list.isError) {
    body = (
      <div className="grid justify-items-center gap-3 px-6 py-14 text-center">
        <p>{t('offline')}</p>
        <Button variant="secondary" onClick={() => list.refetch()}>{t('retry')}</Button>
      </div>
    )
  } else if (rows.length === 0) {
    body =
      q || show !== 'all' ? (
        <EmptyState bare icon={<Tile icon={SearchX} />} title={t('nothingFound')} text={t('nothingFoundText')} />
      ) : (
        <EmptyState bare icon={<Tile icon={Package} />} title={t('noProducts')} text={t('noProductsText')} />
      )
  } else {
    body = (
      <>
        <table className="w-full table-fixed text-sm" data-stale={list.isPlaceholderData || undefined}>
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-(--line)">
              <th scope="col" className="px-4 py-3 font-medium">{t('product')}</th>
              <th scope="col" className="hidden w-36 px-4 py-3 font-medium sm:table-cell">{t('sku')}</th>
              {columns.map((w, i) => (
                <th key={w.id} scope="col" className={`${COLUMN[i]} w-36 px-4 py-3 text-right font-medium`}>
                  <span className="block truncate">{w.name}</span>
                </th>
              ))}
              <th scope="col" className="w-36 px-4 py-3 text-right font-medium">{t('total')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.product_id} className="border-b border-(--line) last:border-0">
                <td className="px-4 py-3">
                  <Link to="/products/$productId" params={{ productId: String(r.product_id) }} className="block truncate font-medium hover:underline">
                    {r.name}
                  </Link>
                  {r.min_stock !== null && Number(r.total) < Number(r.min_stock) && Number(r.total) >= 0 && (
                    <span className="block text-xs text-amber">
                      {t('runningLow')} · {t('minStock').toLowerCase()} {formatDecimal(r.min_stock)}
                    </span>
                  )}
                </td>
                <td className="hidden truncate px-4 py-3 text-muted-foreground sm:table-cell">{r.sku ?? '—'}</td>
                {columns.map((w, i) => (
                  <td key={w.id} className={`${COLUMN[i]} px-4 py-3 text-right whitespace-nowrap`}>
                    <Qty value={r.quantities[w.id] ?? '0'} />
                  </td>
                ))}
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <Qty value={r.total} unit={r.unit} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--line) px-4 py-3 text-xs text-muted-foreground">
          <span aria-live="polite">{t('shown')}: {rows.length} {t('of')} {total}</span>
          {list.hasNextPage && (
            <Button size="sm" variant="secondary" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
              {t('showMore')}
            </Button>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      <StockHeader />
      <div className="rise mb-4 flex flex-wrap items-center gap-3" style={{ '--i': 1 } as CSSProperties}>
        <div className="relative min-w-0 flex-1 basis-64">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={text} onChange={(e) => onType(e.target.value)} placeholder={t('searchProductsShort')} aria-label={t('searchProducts')} className="pl-10" />
        </div>
        <Select value={warehouse ? String(warehouse) : 'all'} onValueChange={(v) => navigate({ search: (s) => ({ ...s, warehouse: v === 'all' ? undefined : Number(v) }) })}>
          <SelectTrigger className="w-48" aria-label={t('warehouse')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allWarehouses')}</SelectItem>
            {active.map((w) => (
              <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={show} onValueChange={(v) => navigate({ search: (s) => ({ ...s, show: v === 'all' ? undefined : (v as Show) }) })}>
          <SelectTrigger className="w-40" aria-label={t('showAll')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('showAll')}</SelectItem>
            <SelectItem value="positive">{t('showPositive')}</SelectItem>
            <SelectItem value="negative">{t('showNegative')}</SelectItem>
            <SelectItem value="low">{t('showLow')}</SelectItem>
          </SelectContent>
        </Select>
        <ExportButton path="/stock/export" params={{ q, warehouse_id: warehouse, show }} />
      </div>
      <section className="glass rise overflow-hidden" style={{ '--i': 2 } as CSSProperties} aria-label={t('balancesTab')}>
        {body}
      </section>
    </>
  )
}

export function Tile({ icon: Icon, color = 'var(--amber)' }: { icon: typeof Package; color?: string }) {
  return (
    <span className="tile" style={{ '--c': color, '--t': '52px' } as CSSProperties} aria-hidden="true">
      <Icon className="size-6" />
    </span>
  )
}
