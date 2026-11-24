// Акт сверки: every sale and payment with one customer in one currency over a period, with the
// balance before, after each line and at the end. Firms send it to customers to agree the debt;
// it prints on one sheet with both sides' signature lines.
import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { ArrowLeft, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { customerQuery } from '../../customers'
import { formatDay, isoToday, localDate } from '../../dates'
import { customerBalancesQuery, statementQuery, type StatementRow } from '../../debts'
import { currencyLabel, formatAmount } from '../../money'
import { PageHeader } from '../../Page'
import { usePrefs } from '../../prefs'
import { useMe } from '../../session'

const route = getRouteApi('/app/customers/$customerId/statement')

export default function StatementPage() {
  const { t, lang } = usePrefs()
  const me = useMe().data
  const { customerId } = route.useParams()
  const id = Number(customerId)
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const from = search.from ?? `${isoToday().slice(0, 4)}-01-01`
  const to = search.to ?? isoToday()
  const customer = useQuery(customerQuery(id)).data
  const balances = useQuery(customerBalancesQuery(id)).data ?? []
  const currency = search.currency ?? balances[0]?.currency ?? 'UZS'
  const s = useQuery(statementQuery(id, currency, from, to))
  const day = (iso: string) => formatDay(localDate(iso), lang)
  const sum = (v: string) => (Number(v) ? formatAmount(v.replace('-', '')) : '—')
  // the balance with who owes whom, so a reader doesn't have to know which sign means what
  const side = (v: string) => (Number(v) < 0 ? `${formatAmount(v.replace('-', ''))} (${t('paidAhead').toLowerCase()})` : formatAmount(v))
  const doc = (r: StatementRow) =>
    r.kind === 'opening' ? (
      t('openingDebt')
    ) : r.kind === 'order' ? (
      <Link to="/orders/$orderId" params={{ orderId: String(r.id) }} className="hover:underline print:no-underline">
        {t('sale')} № {r.number}
      </Link>
    ) : r.kind === 'return' ? (
      <Link to="/returns/$returnId" params={{ returnId: String(r.id) }} className="hover:underline print:no-underline">
        {t('returnDoc')} № {r.number}
      </Link>
    ) : (
      `${t('payment')} № ${r.number}`
    )
  const set = (patch: Partial<typeof search>) => navigate({ search: (x) => ({ ...x, ...patch }), replace: true })

  return (
    <>
      <div className="print:hidden">
        <Link to="/customers/$customerId" params={{ customerId }} className="rise mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-(--text)">
          <ArrowLeft className="size-4" aria-hidden="true" /> {customer?.name ?? t('backToCustomers')}
        </Link>
        <PageHeader
          title={t('statement')}
          description={t('statementIntro')}
          actions={
            <Button variant="outline" onClick={() => window.print()} disabled={!s.data}>
              <Printer aria-hidden="true" /> {t('print')}
            </Button>
          }
        />
        <div className="rise mb-4 flex flex-wrap items-end gap-3" style={{ '--i': 1 } as CSSProperties}>
          <div className="grid gap-1.5">
            <Label htmlFor="statement-from">{t('dateFrom')}</Label>
            <Input id="statement-from" type="date" value={from} max={to} onChange={(e) => set({ from: e.target.value || undefined })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="statement-to">{t('dateTo')}</Label>
            <Input id="statement-to" type="date" value={to} min={from} max="9999-12-31" onChange={(e) => set({ to: e.target.value || undefined })} />
          </div>
          {balances.length > 1 && (
            <div className="grid gap-1.5">
              <Label htmlFor="statement-currency">{t('currency')}</Label>
              <Select value={currency} onValueChange={(c) => set({ currency: c })}>
                <SelectTrigger id="statement-currency" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {balances.map((b) => (
                    <SelectItem key={b.currency} value={b.currency}>{currencyLabel(b.currency, lang)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      <article className="glass rise statement overflow-hidden print:overflow-visible" style={{ '--i': 2 } as CSSProperties}>
        <header className="hidden print:block">
          <h1 className="mb-1 text-xl font-semibold">{t('statement')}</h1>
          <p className="mb-4 text-sm">
            {me?.company_name} — {customer?.name} · {day(from)} – {day(to)} · {currencyLabel(currency, lang)}
          </p>
        </header>
        {s.isPending ? (
          <div className="grid gap-3 p-4" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-9 rounded-xl" />
            ))}
          </div>
        ) : s.isError ? (
          <div className="grid justify-items-center gap-3 px-6 py-14 text-center">
            <p>{t('offline')}</p>
            <Button variant="secondary" onClick={() => s.refetch()}>{t('retry')}</Button>
          </div>
        ) : (
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">
              {t('statement')}: {customer?.name}, {currencyLabel(currency, lang)}
            </caption>
            <thead className="text-left text-xs text-muted-foreground print:text-current">
              <tr className="border-b border-(--line) print:border-current">
                <th scope="col" className="hidden w-40 px-4 py-3 font-medium sm:table-cell print:table-cell">{t('date')}</th>
                <th scope="col" className="px-4 py-3 font-medium">{t('document')}</th>
                <th scope="col" className="w-32 px-4 py-3 text-right font-medium sm:w-40">{t('debitSale')}</th>
                <th scope="col" className="w-32 px-4 py-3 text-right font-medium sm:w-40">{t('creditPaid')}</th>
                <th scope="col" className="hidden w-44 px-4 py-3 text-right font-medium md:table-cell print:table-cell">{t('balanceAfter')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-(--line) font-medium print:border-current">
                <td className="hidden px-4 py-3 sm:table-cell print:table-cell">{day(from)}</td>
                <th scope="row" className="px-4 py-3 text-left font-medium" colSpan={3}>
                  {t('balanceAtStart')}
                </th>
                <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell print:table-cell">{side(s.data.opening)}</td>
              </tr>
              {s.data.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">{t('nothingInPeriod')}</td>
                </tr>
              )}
              {s.data.rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`} className="border-b border-(--line) print:border-current">
                  <td className="hidden px-4 py-3 sm:table-cell print:table-cell">{day(r.date)}</td>
                  <td className="px-4 py-3">
                    {doc(r)}
                    <span className="block text-xs text-muted-foreground sm:hidden">{day(r.date)}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{sum(r.debit)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{sum(r.credit)}</td>
                  <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell print:table-cell">{side(r.balance)}</td>
                </tr>
              ))}
              <tr className="border-b border-(--line) text-muted-foreground print:border-current print:text-current">
                <td className="hidden sm:table-cell print:table-cell" />
                <th scope="row" className="px-4 py-3 text-left font-medium">{t('turnover')}</th>
                <td className="px-4 py-3 text-right tabular-nums">{formatAmount(s.data.debit)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatAmount(s.data.credit)}</td>
                <td className="hidden md:table-cell print:table-cell" />
              </tr>
            </tbody>
          </table>
        )}
        {s.data && (
          <p className="px-4 py-4 text-base">
            {t('balanceAtEnd')} ({day(to)}):{' '}
            <strong className="tabular-nums">
              {side(s.data.closing)} {currencyLabel(currency, lang)}
            </strong>
          </p>
        )}
        <footer className="mt-12 hidden grid-cols-2 gap-8 text-sm print:grid">
          <p className="border-t border-current pt-1">{me?.company_name}</p>
          <p className="border-t border-current pt-1">{customer?.name}</p>
        </footer>
      </article>
    </>
  )
}

export type StatementSearch = { currency?: string; from?: string; to?: string }
