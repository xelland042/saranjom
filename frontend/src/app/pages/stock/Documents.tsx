// Stock documents, newest first, filtered by kind (in the address). A row opens the document.
import type { CSSProperties } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDay, localDate } from '../../dates'
import { EmptyState } from '../../Page'
import { usePrefs } from '../../prefs'
import { documentList, KIND_LABEL, KINDS, warehousesQuery, type Kind } from '../../stock'
import { Tile } from './Balances'
import StockHeader from './StockHeader'

const route = getRouteApi('/app/stock/documents')

export default function Documents() {
  const { t, lang } = usePrefs()
  const { kind } = route.useSearch()
  const navigate = route.useNavigate()
  const list = useInfiniteQuery(documentList(kind))
  const warehouses = useQuery(warehousesQuery)
  const name = new Map(warehouses.data?.map((w) => [w.id, w.name]))
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const total = list.data?.pages[0]?.total ?? 0

  let body
  if (list.isPending) {
    body = (
      <div className="grid gap-3 p-4" aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
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
    body = <EmptyState bare icon={<Tile icon={FileText} />} title={t('noDocuments')} text={t('noDocumentsText')} />
  } else {
    body = (
      <>
        <table className="w-full table-fixed text-sm" data-stale={list.isPlaceholderData || undefined}>
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-(--line)">
              <th scope="col" className="w-20 px-4 py-3 font-medium">№</th>
              <th scope="col" className="px-4 py-3 font-medium">{t('docType')}</th>
              <th scope="col" className="hidden w-44 px-4 py-3 font-medium sm:table-cell">{t('date')}</th>
              <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">{t('warehouse')}</th>
              <th scope="col" className="hidden w-24 px-4 py-3 text-right font-medium lg:table-cell">{t('linesCount')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className={`relative border-b border-(--line) transition-colors last:border-0 hover:bg-(--soft) ${d.cancelled ? 'text-muted-foreground' : ''}`}>
                <td className="px-4 py-3 tabular-nums">{d.number}</td>
                <td className="px-4 py-3">
                  <Link
                    to="/stock/documents/$documentId"
                    params={{ documentId: String(d.id) }}
                    className="font-medium after:absolute after:inset-0 focus-visible:outline-none after:focus-visible:rounded-lg after:focus-visible:outline-2 after:focus-visible:outline-(--accent)"
                  >
                    {t(KIND_LABEL[d.kind])}
                  </Link>
                  {d.cancelled && <Badge variant="secondary" className="ml-2">{t('cancelledBadge')}</Badge>}
                  <span className="block text-xs text-muted-foreground sm:hidden">{formatDay(localDate(d.date), lang)}</span>
                </td>
                <td className="hidden px-4 py-3 sm:table-cell">{formatDay(localDate(d.date), lang)}</td>
                <td className="hidden truncate px-4 py-3 md:table-cell">
                  {name.get(d.warehouse_id)}
                  {d.to_warehouse_id && ` → ${name.get(d.to_warehouse_id)}`}
                </td>
                <td className="hidden px-4 py-3 text-right tabular-nums lg:table-cell">{d.lines}</td>
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
      <div className="rise mb-4" style={{ '--i': 1 } as CSSProperties}>
        <Tabs value={kind ?? 'all'} onValueChange={(v) => navigate({ search: { kind: v === 'all' ? undefined : (v as Kind) } })}>
          <TabsList>
            <TabsTrigger value="all">{t('allTypes')}</TabsTrigger>
            {KINDS.map((k) => (
              <TabsTrigger key={k} value={k}>{t(KIND_LABEL[k])}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <section className="glass rise overflow-hidden" style={{ '--i': 2 } as CSSProperties} aria-label={t('documentsTab')}>
        {body}
      </section>
    </>
  )
}
