// What the company earned in a period: sales less what the sold goods cost less expenses, in the
// company's own currency. This month when the address names no period. Products sold that were
// never received at a price are named, since their cost counts as zero.
import type { CSSProperties, ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CATEGORY_LABEL, profitQuery } from '../../cash'
import { isoToday } from '../../dates'
import { DateRange, presetRange } from '../../ListTools'
import { formatMoney } from '../../money'
import { usePrefs } from '../../prefs'
import MoneyHeader from './MoneyHeader'

const route = getRouteApi('/app/profit')
const minus = (amount: string) => (Number(amount) === 0 ? amount : amount.startsWith('-') ? amount.slice(1) : `-${amount}`)

export default function Profit() {
  const { t, lang } = usePrefs()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const month = presetRange('month')
  const from = search.from ?? month.from!
  const to = search.to ?? (search.from ? isoToday() : month.to!)
  const report = useQuery(profitQuery(from, to))
  const p = report.data

  const money = (amount: string) => formatMoney(amount, p!.currency, lang).replace('-', '−')
  const line = (label: ReactNode, amount: string, o: { strong?: boolean; sub?: boolean; tone?: string } = {}) => (
    <div className={`flex items-baseline justify-between gap-4 px-5 ${o.sub ? 'py-1.5 pl-9 text-sm text-muted-foreground' : 'py-3'} ${o.strong ? 'border-t border-(--line) font-semibold' : ''}`}>
      <dt className="min-w-0">{label}</dt>
      <dd className={`whitespace-nowrap tabular-nums ${o.strong ? 'text-lg' : ''} ${o.tone ?? ''}`}>{money(amount)}</dd>
    </div>
  )

  let body
  if (report.isPending) {
    body = <Skeleton className="m-5 h-64 rounded-xl" />
  } else if (report.isError || !p) {
    body = (
      <div className="grid justify-items-center gap-3 px-6 py-14 text-center">
        <p>{t('offline')}</p>
        <Button variant="secondary" onClick={() => report.refetch()}>{t('retry')}</Button>
      </div>
    )
  } else {
    const margin = Number(p.sales) > 0 ? Math.round((Number(p.gross) / Number(p.sales)) * 100) : null
    body = (
      <dl data-stale={report.isPlaceholderData || undefined} className="py-2">
        {line(
          <>
            {t('profitSales')} <span className="text-xs text-muted-foreground">({t('profitSalesHint')})</span>
          </>,
          p.sales,
        )}
        {line(t('profitCost'), minus(p.cost))}
        {line(
          <>
            {t('profitGross')}
            {margin !== null && <span className="ml-2 text-xs font-normal text-muted-foreground">{margin}% {t('profitMargin')}</span>}
          </>,
          p.gross,
          { strong: true },
        )}
        {line(t('profitExpenses'), minus(p.expenses_total))}
        {p.expenses.map((e) => (
          <div key={e.category}>{line(t(CATEGORY_LABEL[e.category]), minus(e.amount), { sub: true })}</div>
        ))}
        {Number(p.other_income) !== 0 && line(t('moneyIncome'), p.other_income)}
        {line(t('profitNet'), p.profit, { strong: true, tone: Number(p.profit) < 0 ? 'text-red' : Number(p.profit) > 0 ? 'text-green' : '' })}
      </dl>
    )
  }

  return (
    <>
      <MoneyHeader />
      <div className="rise mb-4 flex flex-wrap items-center gap-3" style={{ '--i': 2 } as CSSProperties}>
        {/* "all time" has no dates of its own, and the report needs both */}
        <DateRange value={{ from, to }} onChange={(r) => navigate({ search: r.from || r.to ? r : { from: '2000-01-01', to: isoToday() }, replace: true })} />
      </div>
      <div className="grid max-w-3xl gap-4">
        {p && p.uncosted.count > 0 && (
          <section className="glass rise p-5 text-sm" style={{ '--i': 3 } as CSSProperties} role="status" aria-labelledby="uncosted-title">
            <h2 id="uncosted-title" className="flex items-center gap-2 font-semibold">
              <TriangleAlert className="size-4 flex-none text-amber" aria-hidden="true" />
              {t('uncostedTitle')} ({p.uncosted.count})
            </h2>
            <p className="mt-1 text-muted-foreground">{t('uncostedText')}</p>
            <p className="mt-2">
              {t('uncostedSales')}: <strong className="tabular-nums">{money(p.uncosted.sales)}</strong>
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {p.uncosted.products.map((u) => (
                <li key={u.id}>
                  <Link to="/products/$productId" params={{ productId: String(u.id) }} className="underline-offset-4 hover:underline">{u.name}</Link>
                </li>
              ))}
              {p.uncosted.count > p.uncosted.products.length && <li className="text-muted-foreground">…</li>}
            </ul>
          </section>
        )}
        <section className="glass rise overflow-hidden" style={{ '--i': 3 } as CSSProperties} aria-label={t('profitTab')}>
          {body}
        </section>
        <p className="rise px-1 text-xs text-muted-foreground" style={{ '--i': 4 } as CSSProperties}>{t('profitNote')}</p>
      </div>
    </>
  )
}
