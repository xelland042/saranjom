// Payments received, newest first, searchable by customer. A row opens the payment, where a wrong
// one is cancelled (it stays here, crossed out, and stops counting).
import { useState, type CSSProperties } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { Ban, Search, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDay, localDate } from '../../dates'
import { METHOD_LABEL, METHODS, paymentList, useDebtMutations, type Method, type Payment, type PaymentFilters } from '../../debts'
import { DateRange, ExportButton, SortHeader } from '../../ListTools'
import { currencyLabel, formatDecimal, formatMoney } from '../../money'
import { EmptyState } from '../../Page'
import { usePrefs } from '../../prefs'
import StatStrip from '../../StatStrip'
import { useOverview } from '../../useOverview'
import { useSearchBox } from '../../useSearchBox'
import { Tile } from '../stock/Balances'
import MoneyHeader from './MoneyHeader'
import { useCan } from '../../session'

const route = getRouteApi('/app/payments')

export default function Payments() {
  const { t, lang } = usePrefs()
  const { q = '', from, to, method, sort = '-date' } = route.useSearch()
  const navigate = route.useNavigate()
  const set = (patch: Record<string, unknown>) => navigate({ search: (s) => ({ ...s, ...patch }), replace: true })
  const [text, onType] = useSearchBox(q, (v) => set({ q: v }))
  const filters: PaymentFilters = { q, date_from: from, date_to: to, method, sort }
  const list = useInfiniteQuery(paymentList(filters))
  const first = list.data?.pages[0]
  const { d, today, month, debt } = useOverview()
  const head = (label: string, field: string, extra?: { className?: string; descFirst?: boolean; align?: 'left' | 'right' }) => (
    <SortHeader label={label} field={field} sort={sort} onSort={(s) => set({ sort: s === '-date' ? undefined : s })} {...extra} />
  )
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  // closing keeps the payment, so the dialog's text doesn't change while it fades out
  const [open, setOpen] = useState<{ open: boolean; payment?: Payment }>({ open: false })

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
    body = q || from || to || method ? (
      <EmptyState bare icon={<Tile icon={Search} color="var(--violet)" />} title={t('nothingFound')} text={t('nothingFoundText')} />
    ) : (
      <EmptyState bare icon={<Tile icon={Wallet} color="var(--gold)" />} title={t('noPayments')} text={t('noPaymentsText')} />
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
              <th scope="col" className="hidden w-36 px-4 py-3 font-medium sm:table-cell">{t('paymentMethod')}</th>
              {head(t('amount'), 'amount', { className: 'w-44 text-right', descFirst: true, align: 'right' })}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const cancelled = !!p.cancelled_at
              return (
                <tr key={p.id} className={`relative border-b border-(--line) transition-colors last:border-0 hover:bg-(--soft) ${cancelled ? 'text-muted-foreground' : ''}`}>
                  <td className="px-4 py-3 tabular-nums">{p.number}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setOpen({ open: true, payment: p })}
                      className="block w-full truncate text-left font-medium after:absolute after:inset-0 focus-visible:outline-none after:focus-visible:rounded-lg after:focus-visible:outline-2 after:focus-visible:outline-(--accent)"
                    >
                      {p.customer_name}
                    </button>
                    <span className="block text-xs text-muted-foreground md:hidden">{formatDay(localDate(p.date), lang)}</span>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">{formatDay(localDate(p.date), lang)}</td>
                  <td className="hidden px-4 py-3 sm:table-cell">{cancelled ? <Badge variant="secondary">{t('cancelledBadge')}</Badge> : t(METHOD_LABEL[p.method])}</td>
                  <td className={`px-4 py-3 text-right whitespace-nowrap tabular-nums ${cancelled ? 'line-through' : ''}`}>{formatMoney(p.amount, p.currency, lang)}</td>
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
                  {t('received')}: <strong className="text-(--text)">{formatMoney(s.amount, s.currency, lang)}</strong>
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
      <MoneyHeader />
      {d && (
        <StatStrip
          i={2}
          stats={[
            { label: t('receivedToday'), value: formatMoney(d.received.today, d.currency, lang), link: { to: '/payments', search: { from: today, to: today } } },
            { label: t('receivedMonth'), value: formatMoney(d.received.month, d.currency, lang), link: { to: '/payments', search: month } },
            { label: t('totalOwed'), value: debt ? formatMoney(debt.owed, debt.currency, lang) : '0', link: { to: '/debts' } },
          ]}
        />
      )}
      <div className="rise mb-4 flex flex-wrap items-center gap-3" style={{ '--i': 2 } as CSSProperties}>
        <div className="relative min-w-0 flex-1 basis-64">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={text} onChange={(e) => onType(e.target.value)} placeholder={t('searchCustomers')} aria-label={t('searchCustomers')} className="pl-10" />
        </div>
        <DateRange value={{ from, to }} onChange={(r) => set({ from: r.from, to: r.to })} />
        <Select value={method ?? 'any'} onValueChange={(v) => set({ method: v === 'any' ? undefined : (v as Method) })}>
          <SelectTrigger className="w-44" aria-label={t('paymentMethod')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t('anyMethod')}</SelectItem>
            {METHODS.map((m) => (
              <SelectItem key={m} value={m}>{t(METHOD_LABEL[m])}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ExportButton path="/payments/export" params={filters} />
      </div>
      <section className="glass rise overflow-hidden" style={{ '--i': 3 } as CSSProperties} aria-label={t('paymentsTab')}>
        {body}
      </section>
      <PaymentView payment={open.payment} open={open.open} onOpenChange={(o) => setOpen({ ...open, open: o })} />
    </>
  )
}

function PaymentView({ payment: p, open, onOpenChange }: { payment?: Payment; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, lang } = usePrefs()
  const { cancelPayment } = useDebtMutations()
  const can = useCan()
  const [asking, setAsking] = useState(false)
  if (!p) return null
  const cancelled = !!p.cancelled_at
  const row = (label: string, value: string) => (
    <div className="grid grid-cols-[9rem_1fr] gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  )
  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), setAsking(false))}>
      <DialogContent closeLabel={t('close')} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('payment')} № {p.number}
          </DialogTitle>
          <DialogDescription>{cancelled ? t('paymentCancelledText') : formatMoney(p.amount, p.currency, lang)}</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-2">
          {row(t('customer'), p.customer_name)}
          {row(t('amount'), formatMoney(p.amount, p.currency, lang))}
          {p.exchange_rate && row(t('exchangeRate'), `1 ${p.currency} = ${formatDecimal(p.exchange_rate)} ${currencyLabel('UZS', lang)}`)}
          {row(t('paymentMethod'), t(METHOD_LABEL[p.method]))}
          {row(t('date'), formatDay(localDate(p.date), lang))}
          {p.note && row(t('note'), p.note)}
        </dl>
        <DialogFooter>
          <Button asChild variant="ghost">
            <Link to="/customers/$customerId" params={{ customerId: String(p.customer_id) }}>{t('openCustomer')}</Link>
          </Button>
          {!cancelled &&
            can('money.write') &&
            (asking ? (
              <Button
                variant="destructive"
                disabled={cancelPayment.isPending}
                onClick={() =>
                  cancelPayment.mutate(p.id, {
                    onSuccess: () => (toast.success(t('paymentCancelled')), onOpenChange(false)),
                    onError: () => toast.error(t('notSaved')),
                  })
                }
              >
                <Ban aria-hidden="true" /> {t('confirmCancelPayment')}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setAsking(true)}>
                <Ban aria-hidden="true" /> {t('cancelDoc')}
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
