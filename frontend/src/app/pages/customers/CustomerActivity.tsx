// On a customer's page: their history with notes, their orders and their payments, as tabs. The
// orders and payments are the same lists as their own pages, filtered to this customer.
import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Customer } from '../../customers'
import { formatDay, isoToday, localDate } from '../../dates'
import { METHOD_LABEL, paymentList } from '../../debts'
import { formatMoney } from '../../money'
import { orderList, payState, STATUS_LABEL } from '../../orders'
import { usePrefs } from '../../prefs'
import Timeline from '../../Timeline'
import { PayBadge } from '../orders/PayBadge'
import { useCan } from '../../session'

export default function CustomerActivity({ customer: c }: { customer: Customer }) {
  const { t } = usePrefs()
  const [tab, setTab] = useState('history')
  const can = useCan()
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="history">{t('history')}</TabsTrigger>
          <TabsTrigger value="orders">{t('orders')}</TabsTrigger>
          {can('money.read') && <TabsTrigger value="payments">{t('paymentsTab')}</TabsTrigger>}
        </TabsList>
        {tab === 'orders' && can('orders.write') && (
          <Button size="sm" variant="secondary" asChild>
            <Link to="/orders/new" search={{ customer: c.id }}>
              <Plus aria-hidden="true" /> {t('newOrder')}
            </Link>
          </Button>
        )}
      </div>
      <TabsContent value="history">
        <Timeline scope={{ customerId: c.id }} notes={can('customers.write')} />
      </TabsContent>
      <TabsContent value="orders">
        <Orders customerId={c.id} />
      </TabsContent>
      <TabsContent value="payments">
        <Payments customerId={c.id} />
      </TabsContent>
    </Tabs>
  )
}

function Orders({ customerId }: { customerId: number }) {
  const { t, lang } = usePrefs()
  const list = useInfiniteQuery(orderList({ customer_id: customerId, sort: '-date' }))
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const today = isoToday()
  if (list.isPending) return <Skeleton className="h-24 rounded-xl" />
  if (!rows.length) return <p className="py-2 text-sm text-muted-foreground">{t('noCustomerOrders')}</p>
  return (
    <>
      <ul className="grid">
        {rows.map((o) => {
          const state = payState(o, today)
          return (
            <li key={o.id} className={`relative flex items-center gap-3 border-b border-(--line) py-2.5 last:border-0 ${o.status === 'cancelled' ? 'text-muted-foreground' : ''}`}>
              <span className="grid min-w-0 flex-1">
                <Link to="/orders/$orderId" params={{ orderId: String(o.id) }} className="truncate font-medium after:absolute after:inset-0 hover:underline">
                  {t('order')} № {o.number}
                </Link>
                <span className="text-xs text-muted-foreground">{formatDay(localDate(o.date), lang)}</span>
              </span>
              {state ? <PayBadge state={state} /> : <Badge variant="secondary">{t(STATUS_LABEL[o.status])}</Badge>}
              <span className="w-32 text-right whitespace-nowrap tabular-nums">{formatMoney(o.total, o.currency, lang)}</span>
            </li>
          )
        })}
      </ul>
      {list.hasNextPage && (
        <Button size="sm" variant="secondary" className="mt-2" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
          {t('showMore')}
        </Button>
      )}
    </>
  )
}

function Payments({ customerId }: { customerId: number }) {
  const { t, lang } = usePrefs()
  const list = useInfiniteQuery(paymentList({ customer_id: customerId, sort: '-date' }))
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  if (list.isPending) return <Skeleton className="h-24 rounded-xl" />
  if (!rows.length) return <p className="py-2 text-sm text-muted-foreground">{t('noPayments')}</p>
  return (
    <>
      <ul className="grid">
        {rows.map((p) => (
          <li key={p.id} className={`flex items-center gap-3 border-b border-(--line) py-2.5 last:border-0 ${p.cancelled_at ? 'text-muted-foreground' : ''}`}>
            <span className="grid min-w-0 flex-1">
              <span className="truncate font-medium">
                {t('payment')} № {p.number}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDay(localDate(p.date), lang)} · {p.cancelled_at ? t('cancelledBadge') : t(METHOD_LABEL[p.method])}
              </span>
            </span>
            <span className={`w-32 text-right whitespace-nowrap tabular-nums ${p.cancelled_at ? 'line-through' : ''}`}>{formatMoney(p.amount, p.currency, lang)}</span>
          </li>
        ))}
      </ul>
      {list.hasNextPage && (
        <Button size="sm" variant="secondary" className="mt-2" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
          {t('showMore')}
        </Button>
      )}
    </>
  )
}
