// The suppliers list, under Stock: search (any script, ИНН or phone), active or archived, and for
// those who may see money what we owe each one, with a switch for only those we owe. Filters live
// in the address.
import { useState, type CSSProperties } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { Archive, Plus, Search, SearchX, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatMoney } from '../../money'
import { EmptyState } from '../../Page'
import { usePrefs } from '../../prefs'
import { useCan } from '../../session'
import { supplierList } from '../../suppliers'
import { useSearchBox } from '../../useSearchBox'
import { Tile } from './Balances'
import StockHeader from './StockHeader'
import SupplierForm from './SupplierForm'

const route = getRouteApi('/app/stock/suppliers')

export default function Suppliers() {
  const { t, lang } = usePrefs()
  const can = useCan()
  const money = can('money.read')
  const { q = '', archived = false, owed = false } = route.useSearch()
  const navigate = route.useNavigate()
  const [adding, setAdding] = useState(false)
  const [text, onType] = useSearchBox(q, (v) => navigate({ search: (s) => ({ ...s, q: v }), replace: true }))

  const list = useInfiniteQuery(supplierList(q, archived, owed && money))
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const total = list.data?.pages[0]?.total ?? 0
  const debts = list.data?.pages[0]?.owed ?? []
  const addButton = can('stock.write') && (
    <Button onClick={() => setAdding(true)}>
      <Plus aria-hidden="true" /> {t('addSupplier')}
    </Button>
  )

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
    body =
      q || owed ? (
        <EmptyState bare icon={<Tile icon={SearchX} color="var(--violet)" />} title={t('nothingFound')} text={owed && !q ? t('weOweNothing') : t('nothingFoundText')} />
      ) : archived ? (
        <EmptyState bare icon={<Tile icon={Archive} color="var(--violet)" />} title={t('noArchived')} text={t('noArchivedText')} />
      ) : (
        <EmptyState bare icon={<Tile icon={Truck} />} title={t('noSuppliers')} text={t('noSuppliersText')} action={addButton || undefined} />
      )
  } else {
    body = (
      <>
        <table className="w-full table-fixed text-sm" data-stale={list.isPlaceholderData || undefined}>
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-(--line)">
              <th scope="col" className="px-4 py-3 font-medium">{t('colName')}</th>
              <th scope="col" className="hidden w-36 px-4 py-3 font-medium lg:table-cell">{t('inn')}</th>
              <th scope="col" className="hidden w-44 px-4 py-3 font-medium md:table-cell">{t('phone')}</th>
              {money && <th scope="col" className="w-40 px-4 py-3 text-right font-medium sm:w-48">{t('weOwe')}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="relative border-b border-(--line) transition-colors last:border-0 hover:bg-(--soft)">
                <td className="px-4 py-3">
                  {/* the link covers the whole row, so any part of it opens the supplier */}
                  <Link
                    to="/stock/suppliers/$supplierId"
                    params={{ supplierId: String(s.id) }}
                    className="block truncate font-medium after:absolute after:inset-0 focus-visible:outline-none after:focus-visible:rounded-lg after:focus-visible:outline-2 after:focus-visible:outline-(--accent)"
                  >
                    {s.name}
                  </Link>
                  {/* on phones the other columns are hidden: show the phone under the name */}
                  {s.phone && <span className="block truncate text-xs text-muted-foreground md:hidden">{s.phone}</span>}
                </td>
                <td className="hidden px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums lg:table-cell">{s.inn ?? '—'}</td>
                <td className="hidden px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums md:table-cell">{s.phone ?? '—'}</td>
                {money && (
                  <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                    {s.balances.length === 0
                      ? '—'
                      : s.balances.map((b) => (
                          <span key={b.currency} className={`block ${Number(b.owed) < 0 ? 'text-muted-foreground' : ''}`}>
                            {formatMoney(b.owed, b.currency, lang)}
                          </span>
                        ))}
                  </td>
                )}
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
          <Input type="search" value={text} onChange={(e) => onType(e.target.value)} placeholder={t('searchShort')} aria-label={t('searchSuppliers')} className="pl-10" />
        </div>
        {money && (
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={owed} onCheckedChange={(v) => navigate({ search: (s) => ({ ...s, owed: v || undefined }) })} />
            {t('onlyOwed')}
          </label>
        )}
        <Tabs value={archived ? 'archived' : 'active'} onValueChange={(v) => navigate({ search: (s) => ({ ...s, archived: v === 'archived' ? true : undefined }) })}>
          <TabsList>
            <TabsTrigger value="active">{t('activeTab')}</TabsTrigger>
            <TabsTrigger value="archived">{t('archivedTab')}</TabsTrigger>
          </TabsList>
        </Tabs>
        {addButton}
      </div>

      {money && debts.length > 0 && (
        <p className="rise mb-3 text-sm text-muted-foreground" style={{ '--i': 2 } as CSSProperties}>
          {t('weOweTotal')}: <strong className="text-(--text) tabular-nums">{debts.map((b) => formatMoney(b.owed, b.currency, lang)).join(' + ')}</strong>
        </p>
      )}

      <section className="glass rise overflow-hidden" style={{ '--i': 2 } as CSSProperties} aria-label={t('suppliers')}>
        {body}
      </section>

      <SupplierForm open={adding} onOpenChange={setAdding} />
    </>
  )
}
