// A period's sales by product, customer or the person who entered the order, with what the goods
// cost and what was earned on them for people who see money. This month when the address names no
// period. A row whose sales include goods with no known cost is marked: its profit shows too high.
import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { ArrowLeft, BarChart3, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { isoToday } from '../../dates'
import type { Key } from '../../i18n'
import { DateRange, ExportButton, presetRange, SortHeader } from '../../ListTools'
import { formatMoney } from '../../money'
import { EmptyState, PageHeader } from '../../Page'
import { usePrefs } from '../../prefs'
import { REPORT_BY, salesReport, type ReportBy, type SalesRow } from '../../reports'
import { Qty, Tile } from '../stock/Balances'

const route = getRouteApi('/app/orders/report')
const TAB: Record<ReportBy, Key> = { product: 'products', customer: 'customers', manager: 'staff' }
const NAME: Record<ReportBy, Key> = { product: 'product', customer: 'customer', manager: 'person' }
const percent = (part: string, whole: string) => (Number(whole) > 0 ? `${Math.round((Number(part) / Number(whole)) * 100)}%` : null)

export default function SalesReport() {
  const { t, lang } = usePrefs()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const set = (patch: Record<string, unknown>) => navigate({ search: (s) => ({ ...s, ...patch }), replace: true })
  const month = presetRange('month')
  const by = search.by ?? 'product'
  const sort = search.sort ?? '-sales'
  const filters = { by, date_from: search.from ?? month.from!, date_to: search.to ?? (search.from ? isoToday() : month.to!), sort }
  const report = useQuery(salesReport(filters))
  const r = report.data
  const withMoney = !!r && r.profit !== null
  const money = (amount: string) => formatMoney(amount, r!.currency, lang).replace('-', '−')
  const head = (label: string, field: string, className: string, right = true) => (
    <SortHeader label={label} field={field} sort={sort} onSort={(s) => set({ sort: s === '-sales' ? undefined : s })} descFirst={right} align={right ? 'right' : 'left'} className={`${className} ${right ? 'text-right' : ''}`} />
  )
  const name = (row: SalesRow) => {
    const text = row.name ?? t('removedPerson')
    const link = 'block font-medium break-words hover:underline sm:truncate'
    if (by === 'product' && row.id) return <Link to="/products/$productId" params={{ productId: String(row.id) }} className={link}>{text}</Link>
    if (by === 'customer' && row.id) return <Link to="/customers/$customerId" params={{ customerId: String(row.id) }} className={link}>{text}</Link>
    return <span className={`block font-medium break-words sm:truncate ${row.name ? '' : 'text-muted-foreground'}`}>{text}</span>
  }

  let body
  if (report.isPending) {
    body = (
      <div className="grid gap-3 p-4" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 rounded-xl" />
        ))}
      </div>
    )
  } else if (report.isError || !r) {
    body = (
      <div className="grid justify-items-center gap-3 px-6 py-14 text-center">
        <p>{t('offline')}</p>
        <Button variant="secondary" onClick={() => report.refetch()}>{t('retry')}</Button>
      </div>
    )
  } else if (r.items.length === 0) {
    body = <EmptyState bare icon={<Tile icon={BarChart3} color="var(--green)" />} title={t('noSales')} text={t('noSalesText')} />
  } else {
    const marked = r.items.some((row) => Number(row.uncosted) > 0)
    body = (
      <>
        <table className="w-full table-fixed text-sm" data-stale={report.isPlaceholderData || undefined}>
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-(--line)">
              {head(t(NAME[by]), 'name', '', false)}
              {by === 'product' ? head(t('quantity'), 'quantity', 'hidden w-32 md:table-cell') : head(t('orders'), 'orders', 'hidden w-32 md:table-cell')}
              {head(t('profitSales'), 'sales', 'w-48 sm:w-44')}
              {withMoney && <th scope="col" className="hidden w-40 px-4 py-3 text-right font-medium lg:table-cell">{t('costShort')}</th>}
              {withMoney && head(t('profitTab'), 'profit', 'hidden w-44 sm:table-cell')}
            </tr>
          </thead>
          <tbody>
            {r.items.map((row) => (
              <tr key={row.id ?? 0} className="border-b border-(--line)">
                <td className="px-4 py-3">{name(row)}</td>
                <td className="hidden px-4 py-3 text-right whitespace-nowrap md:table-cell">
                  {by === 'product' ? <Qty value={row.quantity} unit={row.unit ?? undefined} /> : <span className="tabular-nums">{row.orders}</span>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {money(row.sales)}
                  <span className="block text-xs text-muted-foreground">{percent(row.sales, r.sales) ?? '—'}</span>
                  {/* a phone has no room for the profit column */}
                  {withMoney && <span className={`block text-xs sm:hidden ${Number(row.profit) < 0 ? 'text-red' : 'text-muted-foreground'}`}>{t('profitTab').toLowerCase()}: {money(row.profit!)}</span>}
                </td>
                {withMoney && <td className="hidden px-4 py-3 text-right whitespace-nowrap tabular-nums lg:table-cell">{Number(row.uncosted) > 0 && row.uncosted === row.sales ? '—' : money(row.cost!)}</td>}
                {withMoney && (
                  <td className={`hidden px-4 py-3 text-right whitespace-nowrap tabular-nums sm:table-cell ${Number(row.profit) < 0 ? 'text-red' : ''}`}>
                    {Number(row.uncosted) > 0 && (
                      <span title={t('reportUncosted')} className="mr-1.5 inline-block align-middle">
                        <TriangleAlert className="size-3.5 text-amber" aria-hidden="true" />
                        <span className="sr-only">{t('reportUncosted')}</span>
                      </span>
                    )}
                    {money(row.profit!)}
                    <span className="block text-xs text-muted-foreground">{percent(row.profit!, row.sales) ?? '—'}</span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <th scope="row" className="px-4 py-3 text-left">{t('total')}</th>
              <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">{by === 'product' ? '' : r.items.reduce((n, row) => n + row.orders, 0)}</td>
              <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                {money(r.sales)}
                {withMoney && <span className={`block text-xs font-normal sm:hidden ${Number(r.profit) < 0 ? 'text-red' : 'text-muted-foreground'}`}>{t('profitTab').toLowerCase()}: {money(r.profit!)}</span>}
              </td>
              {withMoney && <td className="hidden px-4 py-3 text-right whitespace-nowrap tabular-nums lg:table-cell">{money(r.cost!)}</td>}
              {withMoney && (
                <td className={`hidden px-4 py-3 text-right whitespace-nowrap tabular-nums sm:table-cell ${Number(r.profit) < 0 ? 'text-red' : ''}`}>
                  {money(r.profit!)}
                  <span className="block text-xs font-normal text-muted-foreground">{percent(r.profit!, r.sales) ?? '—'}</span>
                </td>
              )}
            </tr>
          </tfoot>
        </table>
        {marked && (
          <p className="flex items-center gap-2 border-t border-(--line) px-4 py-3 text-xs text-muted-foreground">
            <TriangleAlert className="size-3.5 flex-none text-amber" aria-hidden="true" /> {t('reportUncosted')}
          </p>
        )}
      </>
    )
  }

  return (
    <>
      <Link to="/orders" className="rise mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-(--text)">
        <ArrowLeft className="size-4" aria-hidden="true" /> {t('backToOrders')}
      </Link>
      <PageHeader title={t('salesReport')} description={t('salesReportIntro')} actions={<ExportButton path="/reports/sales/export" params={filters} />} />
      <div className="rise mb-4 flex flex-wrap items-center gap-3" style={{ '--i': 1 } as CSSProperties}>
        <Tabs value={by} onValueChange={(v) => set({ by: v === 'product' ? undefined : (v as ReportBy) })}>
          <TabsList aria-label={t('salesReport')}>
            {REPORT_BY.map((b) => (
              <TabsTrigger key={b} value={b}>{t(TAB[b])}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {/* "all time" has no dates of its own, and the report needs both */}
        <DateRange value={{ from: filters.date_from, to: filters.date_to }} onChange={(d) => set(d.from || d.to ? { from: d.from, to: d.to } : { from: '2000-01-01', to: isoToday() })} />
      </div>
      <section className="glass rise overflow-hidden" style={{ '--i': 2 } as CSSProperties} aria-label={t('salesReport')}>
        {body}
      </section>
    </>
  )
}
