// The home page, an owner's overview: today's and this month's sales, money received, debts, the
// last 30 days, tasks due, stock running out and the latest orders. Each block links to its list.
import { useState, type CSSProperties, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, CheckSquare, Package, Plus, ShoppingCart, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { dashboardQuery, type Dashboard as Data } from '../../dashboard'
import { daysSince, formatDate, formatDay, isoToday, localDate } from '../../dates'
import { formatDecimal, formatMoney } from '../../money'
import { payState, STATUS_LABEL } from '../../orders'
import { PageHeader } from '../../Page'
import { usePrefs } from '../../prefs'
import { useCan, useMe } from '../../session'
import PaymentDialog from '../debts/PaymentDialog'
import { PayBadge } from '../orders/PayBadge'
import TaskRows from '../tasks/TaskRows'
import TaskDialog from '../tasks/TaskDialog'
import type { Task } from '../../tasks'
import SalesChart from './SalesChart'

export default function Dashboard() {
  const { t, lang } = usePrefs()
  const me = useMe().data
  const can = useCan()
  const data = useQuery(dashboardQuery)
  const [paying, setPaying] = useState(false)
  // the moment the page opened: the greeting and date don't change under the reader
  const [now] = useState(() => new Date())
  const hour = now.getHours()
  const greeting = t(hour < 12 ? 'goodMorning' : hour < 18 ? 'goodDay' : 'goodEvening')

  return (
    <>
      <PageHeader
        title={`${greeting}, ${me?.name ?? ''}`}
        description={formatDate(now, lang)}
        actions={
          <>
            {can('money.write') && (
              <Button variant="outline" onClick={() => setPaying(true)}>
                <Wallet aria-hidden="true" /> {t('receivePayment')}
              </Button>
            )}
            {can('orders.write') && (
              <Button asChild>
                <Link to="/orders/new">
                  <Plus aria-hidden="true" /> {t('newOrder')}
                </Link>
              </Button>
            )}
          </>
        }
      />
      {data.isPending ? (
        <div className="grid gap-4" aria-busy="true">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-(--radius)" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-(--radius)" />
        </div>
      ) : data.isError ? (
        <div className="glass grid justify-items-center gap-3 px-6 py-14 text-center">
          <p>{t('offline')}</p>
          <Button variant="secondary" onClick={() => data.refetch()}>{t('retry')}</Button>
        </div>
      ) : (
        <Loaded d={data.data} />
      )}
      <PaymentDialog open={paying} onOpenChange={setPaying} />
    </>
  )
}

function Stat({ label, value, sub, to, i, tone }: { label: string; value: string; sub: ReactNode; to: string; i: number; tone?: 'red' }) {
  return (
    <Link to={to} className="glass rise group grid content-start gap-1 p-5 focus-visible:outline-2 focus-visible:outline-(--accent)" style={{ '--i': i } as CSSProperties}>
      <span className="flex items-center justify-between text-sm text-muted-foreground">
        {label}
        <ArrowRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      </span>
      {/* one line at any width: the size follows the screen, so millions don't wrap */}
      <strong className={`text-[clamp(1.15rem,1.45vw,1.5rem)] whitespace-nowrap tabular-nums ${tone === 'red' ? 'text-red' : ''}`}>{value}</strong>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </Link>
  )
}

function Block({ title, to, more, i, children, className = '' }: { title: string; to: string; more: string; i: number; children: ReactNode; className?: string }) {
  return (
    <section className={`glass rise grid content-start gap-3 p-5 ${className}`} style={{ '--i': i } as CSSProperties} aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Link to={to} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-(--text)">
          {more} <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
      {children}
    </section>
  )
}

function Loaded({ d }: { d: Data }) {
  const { t, lang } = usePrefs()
  const money = (v: string, c = d.currency) => formatMoney(v, c, lang)
  const today = isoToday()
  const [taskDialog, setTaskDialog] = useState<{ open: boolean; task?: Task }>({ open: false })
  // this month so far against the same days of last month
  const month = Number(d.sales.month)
  const prev = Number(d.sales.prev_month)
  const change = prev > 0 ? Math.round(((month - prev) / prev) * 100) : null
  const main = d.debts.totals.find((x) => x.currency === d.currency) ?? d.debts.totals[0]
  const others = d.debts.totals.filter((x) => x !== main)

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          i={1}
          to="/orders"
          label={t('salesToday')}
          value={money(d.sales.today)}
          sub={
            <>
              {t('confirmedOrders')}: {d.sales.orders_today}
              {d.sales.drafts > 0 && ` · ${t('statusDraft').toLowerCase()}: ${d.sales.drafts}`}
            </>
          }
        />
        <Stat
          i={2}
          to="/orders"
          label={t('salesMonth')}
          value={money(d.sales.month)}
          sub={
            change === null ? (
              t('noLastMonth')
            ) : (
              <span className={change >= 0 ? 'text-green' : 'text-red'}>
                {change >= 0 ? '▲' : '▼'} {Math.abs(change)}% {t('vsLastMonth')}
              </span>
            )
          }
        />
        <Stat i={3} to="/payments" label={t('receivedMonth')} value={money(d.received.month)} sub={`${t('today')}: ${money(d.received.today)}`} />
        <Stat
          i={4}
          to="/debts"
          label={t('totalOwed')}
          value={main ? money(main.owed, main.currency) : money('0')}
          tone={main && Number(main.overdue) > 0 ? 'red' : undefined}
          sub={
            <>
              {main && Number(main.overdue) > 0 ? (
                <span className="text-red">
                  {t('overdue')}: {money(main.overdue, main.currency)} · {d.debts.overdue_customers} {t('customersShort')}
                </span>
              ) : (
                t('nothingOverdue')
              )}
              {others.map((o) => (
                <span key={o.currency} className="block">
                  + {money(o.owed, o.currency)}
                </span>
              ))}
            </>
          }
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="glass rise p-5" style={{ '--i': 5 } as CSSProperties}>
          <SalesChart days={d.daily} currency={d.currency} />
        </section>
        <Block i={6} title={t('tasksDue')} to="/tasks" more={t('allTasks')}>
          {d.tasks.items.length ? (
            <TaskRows tasks={d.tasks.items} onOpen={(task) => setTaskDialog({ open: true, task })} />
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckSquare className="size-4" aria-hidden="true" /> {t('noTasksDue')}
            </p>
          )}
        </Block>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Block i={7} title={t('topDebtors')} to="/debts" more={t('debts')}>
          {d.debts.top.length ? (
            <ul className="grid">
              {d.debts.top.map((x) => {
                const late = x.late_since ? daysSince(x.late_since) : 0
                return (
                  <li key={`${x.customer_id}-${x.currency}`} className="relative flex items-center gap-3 border-b border-(--line) py-2 last:border-0">
                    <span className="grid min-w-0 flex-1">
                      <Link to="/customers/$customerId" params={{ customerId: String(x.customer_id) }} className="truncate font-medium after:absolute after:inset-0 hover:underline">
                        {x.customer_name}
                      </Link>
                      {late > 0 && (
                        <span className="text-xs text-red">
                          {t('lateBy')} {late} {t('daysShort')}
                        </span>
                      )}
                    </span>
                    <span className="text-right whitespace-nowrap tabular-nums">{money(x.balance, x.currency)}</span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noDebts')}</p>
          )}
        </Block>

        <Block i={8} title={t('stockAlerts')} to="/stock" more={t('stock')}>
          {d.stock.items.length ? (
            <ul className="grid">
              {d.stock.items.map((p) => (
                <li key={p.product_id} className="relative flex items-center gap-3 border-b border-(--line) py-2 last:border-0">
                  <span className="grid min-w-0 flex-1">
                    <Link to="/products/$productId" params={{ productId: String(p.product_id) }} className="truncate font-medium after:absolute after:inset-0 hover:underline">
                      {p.name}
                    </Link>
                    <span className={`text-xs ${Number(p.stock) < 0 ? 'text-red' : 'text-amber'}`}>
                      {Number(p.stock) < 0 ? t('belowZero') : `${t('runningLow')} · ${t('minStock').toLowerCase()} ${formatDecimal(p.min_stock ?? '0')}`}
                    </span>
                  </span>
                  <span className={`whitespace-nowrap tabular-nums ${Number(p.stock) < 0 ? 'text-red' : ''}`}>
                    {formatDecimal(p.stock)} <span className="text-xs text-muted-foreground">{t(`unit_${p.unit}` as never)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Package className="size-4" aria-hidden="true" /> {t('stockFine')}
            </p>
          )}
        </Block>

        <Block i={9} title={t('latestOrders')} to="/orders" more={t('orders')}>
          {d.recent.length ? (
            <ul className="grid">
              {d.recent.map((o) => {
                const state = payState(o, today)
                return (
                  <li key={o.id} className="relative flex items-center gap-3 border-b border-(--line) py-2 last:border-0">
                    <span className="grid min-w-0 flex-1">
                      <Link to="/orders/$orderId" params={{ orderId: String(o.id) }} className="truncate font-medium after:absolute after:inset-0 hover:underline">
                        {o.customer_name}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        № {o.number} · {o.date === today ? t('today') : formatDay(localDate(o.date), lang)}
                      </span>
                    </span>
                    <span className="grid justify-items-end gap-0.5">
                      <span className="whitespace-nowrap tabular-nums">{money(o.total, o.currency)}</span>
                      {state ? <PayBadge state={state} /> : <Badge variant="secondary">{t(STATUS_LABEL[o.status])}</Badge>}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShoppingCart className="size-4" aria-hidden="true" /> {t('noOrders')}
            </p>
          )}
        </Block>
      </div>
      <TaskDialog open={taskDialog.open} task={taskDialog.task} onOpenChange={(open) => setTaskDialog({ ...taskDialog, open })} />
    </div>
  )
}
