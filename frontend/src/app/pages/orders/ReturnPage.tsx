// One return: what came back from which order, read-only. It can be printed (a return note both
// sides sign) and cancelled, which takes the goods out of the warehouse again and brings the
// customer's debt back; it stays in the history.
import { useState, type CSSProperties, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { ArrowLeft, Ban, FileX, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '../../api'
import { formatDay, localDate } from '../../dates'
import type { Key } from '../../i18n'
import { formatAmount, formatDecimal, formatMoney } from '../../money'
import { returnQuery, useOrderMutations, type SalesReturn } from '../../orders'
import { EmptyState, PageHeader } from '../../Page'
import { usePrefs } from '../../prefs'
import { useCan, useMe } from '../../session'
import { warehousesQuery } from '../../stock'
import Timeline from '../../Timeline'
import { Tile } from '../stock/Balances'

const route = getRouteApi('/app/returns/$returnId')

export default function ReturnPage() {
  const { t } = usePrefs()
  const { returnId } = route.useParams()
  const ret = useQuery(returnQuery(Number(returnId)))
  const back = ret.data ? (
    <Link to="/orders/$orderId" params={{ orderId: String(ret.data.order_id) }} className="rise mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-(--text) print:hidden">
      <ArrowLeft className="size-4" aria-hidden="true" /> {t('order')} № {ret.data.order_number}
    </Link>
  ) : (
    <Link to="/orders" className="rise mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-(--text) print:hidden">
      <ArrowLeft className="size-4" aria-hidden="true" /> {t('backToOrders')}
    </Link>
  )
  if (ret.isError) {
    const missing = ret.error instanceof ApiError && (ret.error.status === 404 || ret.error.status === 422)
    return (
      <>
        {back}
        <EmptyState
          icon={<Tile icon={FileX} color="var(--violet)" />}
          title={t(missing ? 'returnNotFound' : 'offline')}
          text=""
          action={!missing && <Button variant="secondary" onClick={() => ret.refetch()}>{t('retry')}</Button>}
        />
      </>
    )
  }
  if (!ret.data) return <Skeleton className="h-64 rounded-3xl" />
  return (
    <>
      {back}
      <Loaded ret={ret.data} />
    </>
  )
}

function Loaded({ ret }: { ret: SalesReturn }) {
  const { t, lang } = usePrefs()
  const can = useCan()
  const me = useMe().data
  const { cancelReturn } = useOrderMutations()
  const [confirming, setConfirming] = useState(false)
  const warehouse = useQuery(warehousesQuery).data?.find((w) => w.id === ret.warehouse_id)
  const day = formatDay(localDate(ret.date), lang)
  const vatRate = ret.lines.find((l) => Number(l.vat_rate))?.vat_rate

  const cancel = () =>
    cancelReturn.mutate(ret.id, {
      onSuccess: (r) => {
        setConfirming(false)
        toast.success(t('returnCancelled'))
        if (r.negative.length)
          toast.warning(t('wentNegative'), {
            description: r.negative.map((n) => `${n.product_name}: ${formatDecimal(n.quantity)}`).join(', '),
            duration: 10_000,
          })
      },
      onError: () => toast.error(t('notSaved')),
    })

  const lineTable = (
    <table className="w-full table-fixed text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr className="border-b border-(--line)">
          <th scope="col" className="w-10 px-4 py-3 font-medium">#</th>
          <th scope="col" className="px-4 py-3 font-medium">{t('product')}</th>
          <th scope="col" className="w-32 px-4 py-3 text-right font-medium">{t('quantity')}</th>
          <th scope="col" className="hidden w-36 px-4 py-3 text-right font-medium sm:table-cell print:table-cell">{t('price')}</th>
          <th scope="col" className="hidden w-24 px-4 py-3 text-right font-medium md:table-cell print:table-cell">{t('discount')}</th>
          <th scope="col" className="w-40 px-4 py-3 text-right font-medium">{t('sum')}</th>
        </tr>
      </thead>
      <tbody>
        {ret.lines.map((l, i) => (
          <tr key={l.id} className="border-b border-(--line) last:border-0">
            <td className="px-4 py-3 text-muted-foreground tabular-nums">{i + 1}</td>
            <td className="px-4 py-3">{l.product_name}</td>
            <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
              {formatDecimal(l.quantity)} <span className="text-xs text-muted-foreground">{t(`unit_${l.unit}` as Key)}</span>
            </td>
            <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell print:table-cell">{formatAmount(l.price)}</td>
            <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell print:table-cell">{Number(l.discount) ? `${formatDecimal(l.discount)}%` : '—'}</td>
            <td className="px-4 py-3 text-right tabular-nums">{formatAmount(l.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
  const totals = (
    <div className="grid justify-items-end gap-0.5 border-t border-(--line) px-4 py-3 text-sm">
      <span>
        {t('total')}: <strong className="tabular-nums">{formatMoney(ret.total, ret.currency, lang)}</strong>
      </span>
      {Number(ret.vat_total) > 0 && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {t('vatIncluded')} ({formatDecimal(vatRate ?? '0')}%): {formatAmount(ret.vat_total)}
        </span>
      )}
    </div>
  )

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`${t('returnDoc')} № ${ret.number}`}
          description={ret.cancelled && <Badge variant="secondary">{t('cancelledBadge')}</Badge>}
          actions={
            <>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer aria-hidden="true" /> {t('print')}
              </Button>
              {!ret.cancelled && can('orders.write') && (
                <Button variant="ghost" onClick={() => setConfirming(true)}>
                  <Ban aria-hidden="true" /> {t('cancelDoc')}
                </Button>
              )}
            </>
          }
        />
        <section className="glass rise mb-4 p-5" style={{ '--i': 1 } as CSSProperties}>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {([
              [
                t('customer'),
                <Link key="c" to="/customers/$customerId" params={{ customerId: String(ret.customer_id) }} className="font-medium hover:underline">
                  {ret.customer_name}
                </Link>,
              ],
              [
                t('order'),
                <Link key="o" to="/orders/$orderId" params={{ orderId: String(ret.order_id) }} className="hover:underline">
                  № {ret.order_number}
                </Link>,
              ],
              [t('date'), day],
              [t('toWarehouse'), warehouse?.name ?? ''],
              ...(ret.note ? [[t('note'), ret.note]] : []),
            ] as [string, ReactNode][]).map(([label, value]) => (
              <div key={label} className="grid gap-0.5">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="break-words">{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className={`glass rise overflow-hidden ${ret.cancelled ? 'opacity-70' : ''}`} style={{ '--i': 2 } as CSSProperties} aria-label={t('linesCount')}>
          {lineTable}
          {totals}
        </section>
        <section className="glass rise mt-4 p-5" style={{ '--i': 3 } as CSSProperties}>
          <Timeline scope={{ entity: 'return', entityId: ret.id }} title={t('history')} />
        </section>
      </div>

      {/* the printed return note: the customer hands the goods back, the company takes them */}
      <article className="invoice hidden print:block">
        <h1 className="mb-1 text-xl font-semibold">
          {t('returnNote')} № {ret.number}
        </h1>
        <p className="mb-4 text-sm">
          {day} · {t('order')} № {ret.order_number}
        </p>
        <dl className="mb-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs">{t('buyer')}</dt>
            <dd className="font-medium">{ret.customer_name}</dd>
          </div>
          <div>
            <dt className="text-xs">{t('supplier')}</dt>
            <dd className="font-medium">{me?.company_name}</dd>
          </div>
        </dl>
        {lineTable}
        {totals}
        <div className="mt-12 grid grid-cols-2 gap-8 text-sm">
          <p className="border-t border-current pt-1">{t('handedOver')}</p>
          <p className="border-t border-current pt-1">{t('receivedBy')}</p>
        </div>
      </article>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent closeLabel={t('close')} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('cancelReturnQ')}</DialogTitle>
            <DialogDescription>{t('cancelReturnText')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>{t('back')}</Button>
            <Button variant="destructive" disabled={cancelReturn.isPending} onClick={cancel}>{t('cancelDoc')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
