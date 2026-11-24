// Sales orders: search by customer (any script), status tabs, a period, paid or not, sortable
// columns, the confirmed ones' totals and an Excel file. Every filter lives in the address.
import { useState, type CSSProperties } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { Percent, Plus, Search, ShoppingCart } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDay, localDate } from '../../dates'
import { DateRange, ExportButton, SortHeader } from '../../ListTools'
import { formatMoney } from '../../money'
import { orderList, PAY_LABEL, payState, STATUS_LABEL, STATUSES, type OrderFilters, type PaymentFilter, type Status } from '../../orders'
import { EmptyState, PageHeader } from '../../Page'
import { usePrefs } from '../../prefs'
import StatStrip from '../../StatStrip'
import { useOverview } from '../../useOverview'
import { useSearchBox } from '../../useSearchBox'
import { Tile } from '../stock/Balances'
import VatDialog from './VatDialog'
import { PayBadge } from './PayBadge'
import { useCan } from '../../session'

const route = getRouteApi('/app/orders')

export default function OrderList() {
  const { t, lang } = usePrefs()
  const { q = '', status, from, to, payment, sort = '-date' } = route.useSearch()
  const navigate = route.useNavigate()
  const set = (patch: Record<string, unknown>) => navigate({ search: (s) => ({ ...s, ...patch }), replace: true })
  const [text, onType] = useSearchBox(q, (v) => set({ q: v }))
  const [vat, setVat] = useState(false)
  const filters: OrderFilters = { q, status, date_from: from, date_to: to, payment, sort }
  const list = useInfiniteQuery(orderList(filters))
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const first = list.data?.pages[0]
  const { d, today, month, debt } = useOverview()
  const filtered = !!(q || from || to || payment)
  const can = useCan()
  const newButton = can('orders.write') && (
    <Button asChild>
      <Link to="/orders/new">
        <Plus aria-hidden="true" /> {t('newOrder')}
      </Link>
    </Button>
  )
  const head = (label: string, field: string, extra?: { className?: string; descFirst?: boolean; align?: 'left' | 'right' }) => (
    <SortHeader label={label} field={field} sort={sort} onSort={(s) => set({ sort: s === '-date' ? undefined : s })} {...extra} />
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
    body = filtered ? (
      <EmptyState bare icon={<Tile icon={Search} color="var(--violet)" />} title={t('nothingFound')} text={t('nothingFoundText')} />
    ) : (
      <EmptyState bare icon={<Tile icon={ShoppingCart} color="var(--green)" />} title={t('noOrders')} text={t('noOrdersText')} action={newButton || undefined} />
    )
  } else {
    body = (
      <>
        <table className="w-full table-fixed text-sm" data-stale={list.isPlaceholderData || undefined}>
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-(--line)">
              {head('№', 'number', { className: 'w-20', descFirst: true })}
              {head(t('customer'), 'customer')}
              {head(t('date'), 'date', { className: 'hidden w-44 md:table-cell', descFirst: true })}
              <th scope="col" className="hidden w-36 px-4 py-3 font-medium sm:table-cell">{t('state')}</th>
              {head(t('dueDate'), 'due', { className: 'hidden w-48 xl:table-cell' })}
              {head(t('total'), 'total', { className: 'w-44 text-right sm:w-56', descFirst: true, align: 'right' })}
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const state = payState(o, today)
              return (
                <tr key={o.id} className={`relative border-b border-(--line) transition-colors last:border-0 hover:bg-(--soft) ${o.status === 'cancelled' ? 'text-muted-foreground' : ''}`}>
                  <td className="px-4 py-3 tabular-nums">{o.number}</td>
                  <td className="px-4 py-3">
                    <Link
                      to="/orders/$orderId"
                      params={{ orderId: String(o.id) }}
                      className="block truncate font-medium after:absolute after:inset-0 focus-visible:outline-none after:focus-visible:rounded-lg after:focus-visible:outline-2 after:focus-visible:outline-(--accent)"
                    >
                      {o.customer_name}
                    </Link>
                    <span className="block text-xs text-muted-foreground md:hidden">{formatDay(localDate(o.date), lang)}</span>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">{formatDay(localDate(o.date), lang)}</td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    {state ? <PayBadge state={state} /> : <Badge variant="secondary">{t(STATUS_LABEL[o.status])}</Badge>}
                  </td>
                  <td className={`hidden px-4 py-3 xl:table-cell ${state === 'overdue' ? 'text-red' : ''}`}>
                    {state && state !== 'paid' && o.due_date ? formatDay(localDate(o.due_date), lang) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                    {formatMoney(o.total, o.currency, lang)}
                    {(state === 'partial' || state === 'overdue') && o.unpaid && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {t('payUnpaid').toLowerCase()}: {formatMoney(o.unpaid, o.currency, lang)}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--line) px-4 py-3 text-xs text-muted-foreground">
          <span aria-live="polite">
            {t('shown')}: {rows.length} {t('of')} {first?.total ?? 0}
          </span>
          {first && first.sums.length > 0 && (
            <span className="flex flex-wrap gap-x-4 tabular-nums">
              {first.sums.map((s) => (
                <span key={s.currency}>
                  {t('confirmedTotal')}: <strong className="text-(--text)">{formatMoney(s.total, s.currency, lang)}</strong>
                  {Number(s.unpaid) > 0 && ` · ${t('payUnpaid').toLowerCase()}: ${formatMoney(s.unpaid, s.currency, lang)}`}
                </span>
              ))}
            </span>
          )}
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
      <PageHeader
        title={t('orders')}
        description={t('ordersIntro')}
        actions={
          <>
            {can('settings') && (
              <Button variant="outline" onClick={() => setVat(true)}>
                <Percent aria-hidden="true" /> {t('vatRates')}
              </Button>
            )}
            <ExportButton path="/orders/export" params={filters} />
            {newButton}
          </>
        }
      />
      {d && (
        <StatStrip
          stats={[
            { label: t('salesToday'), value: formatMoney(d.sales.today, d.currency, lang), link: { to: '/orders', search: { from: today, to: today, status: 'confirmed' } } },
            { label: t('salesMonth'), value: formatMoney(d.sales.month, d.currency, lang), link: { to: '/orders', search: { ...month, status: 'confirmed' } } },
            { label: t('statusDraft'), value: d.sales.drafts, link: { to: '/orders', search: { status: 'draft' } } },
            {
              label: t('payOverdue'),
              value: debt ? formatMoney(debt.overdue, debt.currency, lang) : '0',
              tone: debt && Number(debt.overdue) > 0 ? 'red' : undefined,
              link: { to: '/orders', search: { payment: 'overdue' } },
            },
          ]}
        />
      )}
      <div className="rise mb-3 flex flex-wrap items-center gap-3" style={{ '--i': 1 } as CSSProperties}>
        <div className="relative min-w-0 flex-1 basis-64">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={text} onChange={(e) => onType(e.target.value)} placeholder={t('searchOrders')} aria-label={t('searchOrders')} className="pl-10" />
        </div>
        <Tabs value={status ?? 'all'} onValueChange={(v) => set({ status: v === 'all' ? undefined : (v as Status) })}>
          <TabsList>
            <TabsTrigger value="all">{t('allTypes')}</TabsTrigger>
            {STATUSES.map((s) => (
              <TabsTrigger key={s} value={s}>{t(STATUS_LABEL[s])}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="rise mb-4 flex flex-wrap items-center gap-2" style={{ '--i': 2 } as CSSProperties}>
        <DateRange value={{ from, to }} onChange={(r) => set({ from: r.from, to: r.to })} />
        <Select value={payment ?? 'any'} onValueChange={(v) => set({ payment: v === 'any' ? undefined : (v as PaymentFilter) })}>
          <SelectTrigger className="w-48" aria-label={t('paymentState')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t('payAny')}</SelectItem>
            <SelectItem value="unpaid">{t('payNotPaid')}</SelectItem>
            <SelectItem value="overdue">{t(PAY_LABEL.overdue)}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <section className="glass rise overflow-hidden" style={{ '--i': 3 } as CSSProperties} aria-label={t('orders')}>
        {body}
      </section>
      <VatDialog open={vat} onOpenChange={setVat} />
    </>
  )
}
