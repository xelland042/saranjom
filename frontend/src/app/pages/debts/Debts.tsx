// Who owes the company, and how late: per customer and currency, biggest first or longest late
// first, with totals per currency. Search, "overdue only" and the sort are in the address.
import type { CSSProperties } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { Search, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { daysSince, formatDay, localDate } from '../../dates'
import { debtList, type DebtSort } from '../../debts'
import { ExportButton } from '../../ListTools'
import { formatMoney } from '../../money'
import { EmptyState } from '../../Page'
import { usePrefs } from '../../prefs'
import { useSearchBox } from '../../useSearchBox'
import { Tile } from '../stock/Balances'
import MoneyHeader from './MoneyHeader'

const route = getRouteApi('/app/debts')

export default function Debts() {
  const { t, lang } = usePrefs()
  const { q = '', overdue = false, sort = 'balance' } = route.useSearch()
  const navigate = route.useNavigate()
  const [text, onType] = useSearchBox(q, (v) => navigate({ search: (s) => ({ ...s, q: v }), replace: true }))
  const list = useInfiniteQuery(debtList(q, overdue, sort))
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const first = list.data?.pages[0]
  const money = (v: string, c: string) => formatMoney(v, c, lang)

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
      q || overdue ? (
        <EmptyState bare icon={<Tile icon={Search} color="var(--violet)" />} title={t('nothingFound')} text={t('nothingFoundText')} />
      ) : (
        <EmptyState bare icon={<Tile icon={Wallet} color="var(--gold)" />} title={t('noDebts')} text={t('noDebtsText')} />
      )
  } else {
    body = (
      <>
        <table className="w-full table-fixed text-sm" data-stale={list.isPlaceholderData || undefined}>
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-(--line)">
              <th scope="col" className="px-4 py-3 font-medium">{t('customer')}</th>
              <th scope="col" className="w-44 px-4 py-3 text-right font-medium">{t('debt')}</th>
              <th scope="col" className="hidden w-44 px-4 py-3 text-right font-medium sm:table-cell">{t('overdue')}</th>
              <th scope="col" className="hidden w-40 px-4 py-3 font-medium lg:table-cell">{t('lastPayment')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const late = d.late_since ? daysSince(d.late_since) : 0
              return (
                <tr key={`${d.customer_id}-${d.currency}`} className="relative border-b border-(--line) transition-colors last:border-0 hover:bg-(--soft)">
                  <td className="px-4 py-3">
                    <Link
                      to="/customers/$customerId"
                      params={{ customerId: String(d.customer_id) }}
                      className="block truncate font-medium after:absolute after:inset-0 focus-visible:outline-none after:focus-visible:rounded-lg after:focus-visible:outline-2 after:focus-visible:outline-(--accent)"
                    >
                      {d.customer_name}
                    </Link>
                    {late > 0 && (
                      <span className="block text-xs text-red">
                        {t('lateBy')} {late} {t('daysShort')}
                        <span className="sm:hidden"> · {money(d.overdue, d.currency)}</span>
                      </span>
                    )}
                  </td>
                  <td className={`px-4 py-3 text-right whitespace-nowrap tabular-nums ${Number(d.balance) < 0 ? 'text-muted-foreground' : 'font-medium'}`}>
                    {money(d.balance, d.currency)}
                    {Number(d.balance) < 0 && <span className="block text-xs">{t('paidAhead')}</span>}
                  </td>
                  <td className={`hidden px-4 py-3 text-right whitespace-nowrap tabular-nums sm:table-cell ${Number(d.overdue) > 0 ? 'text-red' : 'text-muted-foreground'}`}>
                    {Number(d.overdue) > 0 ? money(d.overdue, d.currency) : '—'}
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">{d.last_payment ? formatDay(localDate(d.last_payment), lang) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--line) px-4 py-3 text-xs text-muted-foreground">
          <span aria-live="polite">{t('shown')}: {rows.length} {t('of')} {first?.total ?? 0}</span>
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
      <MoneyHeader />
      {first && first.totals.length > 0 && (
        <div className="rise mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" style={{ '--i': 1 } as CSSProperties}>
          {first.totals.map((x) => (
            <section key={x.currency} className="glass grid gap-1 p-4" aria-label={`${t('totalOwed')}, ${x.currency}`}>
              <span className="text-xs text-muted-foreground">{t('totalOwed')}</span>
              <strong className="text-xl tabular-nums">{money(x.owed, x.currency)}</strong>
              <span className={`text-xs tabular-nums ${Number(x.overdue) > 0 ? 'text-red' : 'text-muted-foreground'}`}>
                {t('overdue')}: {money(x.overdue, x.currency)}
              </span>
            </section>
          ))}
        </div>
      )}
      <div className="rise mb-4 flex flex-wrap items-center gap-3" style={{ '--i': 2 } as CSSProperties}>
        <div className="relative min-w-0 flex-1 basis-64">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={text} onChange={(e) => onType(e.target.value)} placeholder={t('searchCustomers')} aria-label={t('searchCustomers')} className="pl-10" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={overdue} onCheckedChange={(v) => navigate({ search: (s) => ({ ...s, overdue: v || undefined }) })} />
          {t('overdueOnly')}
        </label>
        <Tabs value={sort} onValueChange={(v) => navigate({ search: (s) => ({ ...s, sort: v === 'late' ? 'late' : undefined }) })}>
          <TabsList aria-label={t('sortBy')}>
            <TabsTrigger value="balance">{t('sortBiggest')}</TabsTrigger>
            <TabsTrigger value="late">{t('sortLatest')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <ExportButton path="/debts/export" params={{ q, overdue, sort }} />
      </div>
      <section className="glass rise overflow-hidden" style={{ '--i': 3 } as CSSProperties} aria-label={t('debts')}>
        {body}
      </section>
    </>
  )
}

export type DebtSearch = { q?: string; overdue?: true; sort?: DebtSort }
