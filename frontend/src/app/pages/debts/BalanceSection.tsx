// On a customer's page: what they owe in each currency, how much of it is late, and the ways to
// change it (receive a payment, the opening debt) or show it (the akt sverki).
import { useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { BellPlus, FileText, History, Plus, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { Customer } from '../../customers'
import { daysSince, formatDay, isoToday, localDate } from '../../dates'
import { customerBalancesQuery } from '../../debts'
import { formatMoney } from '../../money'
import { usePrefs } from '../../prefs'
import { priceListsQuery } from '../../products'
import { Tile } from '../stock/Balances'
import TaskDialog, { type TaskDraft } from '../tasks/TaskDialog'
import OpeningDialog from './OpeningDialog'
import PaymentDialog from './PaymentDialog'
import { useCan } from '../../session'

export default function BalanceSection({ customer: c }: { customer: Customer }) {
  const { t, lang } = usePrefs()
  const can = useCan()
  const balances = useQuery(customerBalancesQuery(c.id))
  const lists = useQuery(priceListsQuery).data ?? []
  const own = lists.find((l) => (c.price_list_id ? l.id === c.price_list_id : l.is_default))?.currency ?? 'UZS'
  const [paying, setPaying] = useState<{ open: boolean; currency?: string }>({ open: false })
  const [opening, setOpening] = useState(false)
  // a task about the late debt, filled in for today
  const [reminder, setReminder] = useState<TaskDraft | null>(null)
  const rows = balances.data ?? []
  const money = (v: string, cur: string) => formatMoney(v, cur, lang)

  return (
    <section className="glass rise p-5" style={{ '--i': 1 } as CSSProperties} aria-labelledby="customer-balance">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="customer-balance" className="text-lg font-semibold">{t('debt')}</h2>
        <div className="flex flex-wrap gap-2">
          {can('money.write') && (
            <Button size="sm" variant="ghost" onClick={() => setOpening(true)}>
              <History aria-hidden="true" /> {t('openingDebt')}
            </Button>
          )}
          {rows.length > 0 && (
            <Button size="sm" variant="secondary" asChild>
              <Link to="/customers/$customerId/statement" params={{ customerId: String(c.id) }} search={{ currency: rows.find((b) => Number(b.balance))?.currency ?? rows[0].currency }}>
                <FileText aria-hidden="true" /> {t('statement')}
              </Link>
            </Button>
          )}
          {can('money.write') && (
            <Button size="sm" onClick={() => setPaying({ open: true })}>
              <Plus aria-hidden="true" /> {t('receivePayment')}
            </Button>
          )}
        </div>
      </div>
      {balances.isPending ? (
        <Skeleton className="h-16 rounded-xl" />
      ) : rows.length === 0 ? (
        <div className="flex items-center gap-3 py-2">
          <Tile icon={Wallet} color="var(--gold)" />
          <p className="text-sm text-muted-foreground">{t('noBalanceYet')}</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map((b) => {
            const late = b.late_since ? daysSince(b.late_since) : 0
            const n = Number(b.balance)
            return (
              <li key={b.currency} className="grid gap-1 rounded-2xl bg-(--soft) p-4">
                <span className="text-xs text-muted-foreground">{n < 0 ? t('paidAhead') : n > 0 ? t('owes') : t('settled')}</span>
                <strong className="text-2xl tabular-nums">{money(b.balance.replace('-', ''), b.currency)}</strong>
                {Number(b.overdue) > 0 && (
                  <span className="text-sm text-red tabular-nums">
                    {t('overdue')}: {money(b.overdue, b.currency)} · {t('lateBy')} {late} {t('daysShort')}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {t('lastPayment')}: {b.last_payment ? formatDay(localDate(b.last_payment), lang) : '—'}
                </span>
                {b.opening && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t(Number(b.opening.amount) < 0 ? 'openingAhead' : 'openingDebt')}: {money(b.opening.amount.replace('-', ''), b.currency)} ·{' '}
                    {formatDay(localDate(b.opening.date), lang)}
                  </span>
                )}
                {n > 0 && (
                  <span className="mt-1 flex flex-wrap gap-2">
                    {can('money.write') && (
                      <Button size="sm" variant="secondary" onClick={() => setPaying({ open: true, currency: b.currency })}>
                        {t('receivePayment')}
                      </Button>
                    )}
                    {Number(b.overdue) > 0 && can('tasks') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setReminder({
                            title: `${t('debtTaskTitle')}: ${money(b.overdue, b.currency)}`,
                            due_date: isoToday(),
                            customer_id: c.id,
                            customer_name: c.name,
                          })
                        }
                      >
                        <BellPlus aria-hidden="true" /> {t('remindMe')}
                      </Button>
                    )}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <PaymentDialog open={paying.open} onOpenChange={(open) => setPaying({ ...paying, open })} customer={c} currency={paying.currency} />
      <TaskDialog open={!!reminder} onOpenChange={(o) => !o && setReminder(null)} draft={reminder ?? undefined} />
      <OpeningDialog open={opening} onOpenChange={setOpening} customerId={c.id} balances={rows} currency={rows[0]?.currency ?? own} />
    </section>
  )
}
