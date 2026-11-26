// One stock document, read-only: posted documents are never edited. Cancelling keeps it in the
// history and stops it counting, so a mistake is fixed by cancelling and entering it again.
import { useState, type CSSProperties, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { ArrowLeft, Ban, FileX } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '../../api'
import { formatDay, localDate } from '../../dates'
import type { Key } from '../../i18n'
import { currencyLabel, formatAmount, formatDecimal } from '../../money'
import { EmptyState, PageHeader } from '../../Page'
import { usePrefs } from '../../prefs'
import { documentQuery, KIND_LABEL, useStockMutations, warehousesQuery, type StockDocument } from '../../stock'
import { Tile } from './Balances'
import { useCan } from '../../session'

const route = getRouteApi('/app/stock/documents/$documentId')

export default function DocumentView() {
  const { t } = usePrefs()
  const { documentId } = route.useParams()
  const doc = useQuery(documentQuery(Number(documentId)))
  const back = (
    <Link to="/stock/documents" className="rise mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-(--text)">
      <ArrowLeft className="size-4" aria-hidden="true" /> {t('backToDocuments')}
    </Link>
  )
  if (doc.isPending)
    return (
      <div aria-busy="true">
        {back}
        <Skeleton className="mb-6 h-9 w-72 rounded-xl" />
        <Skeleton className="h-64 rounded-(--radius)" />
      </div>
    )
  if (doc.isError) {
    const missing = doc.error instanceof ApiError && (doc.error.status === 404 || doc.error.status === 422)
    return (
      <>
        {back}
        <EmptyState
          icon={<Tile icon={FileX} color="var(--violet)" />}
          title={t(missing ? 'documentNotFound' : 'offline')}
          text=""
          action={!missing && <Button variant="secondary" onClick={() => doc.refetch()}>{t('retry')}</Button>}
        />
      </>
    )
  }
  return (
    <>
      {back}
      <Loaded doc={doc.data} />
    </>
  )
}

function Loaded({ doc }: { doc: StockDocument }) {
  const { t, lang } = usePrefs()
  const can = useCan()
  const { cancelDocument } = useStockMutations()
  const [confirming, setConfirming] = useState(false)
  const warehouses = useQuery(warehousesQuery)
  const name = (id: number | null) => warehouses.data?.find((w) => w.id === id)?.name ?? ''
  const withPrices = doc.lines.some((l) => l.price)
  let sum = 0
  for (const l of doc.lines) sum += Number(l.quantity) * (Number(l.price) || 0)

  const cancel = () =>
    cancelDocument.mutate(doc.id, {
      onSuccess: (d) => {
        setConfirming(false)
        toast.success(t('docCancelled'))
        if (d.negative.length)
          toast.warning(t('wentNegative'), {
            description: d.negative.map((n) => `${n.product_name}: ${formatDecimal(n.quantity)}`).join(', '),
            duration: 10_000,
          })
      },
      onError: () => toast.error(t('notSaved')),
    })

  const row = (label: Key, value: ReactNode) => (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{t(label)}</dt>
      <dd>{value || '—'}</dd>
    </div>
  )

  return (
    <>
      <PageHeader
        title={`${t(KIND_LABEL[doc.kind])} № ${doc.number}`}
        description={doc.cancelled && <Badge variant="secondary">{t('cancelledBadge')}</Badge>}
        actions={
          !doc.cancelled &&
          can('stock.write') && (
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              <Ban aria-hidden="true" /> {t('cancelDoc')}
            </Button>
          )
        }
      />

      <section className="glass rise mb-4 p-5" style={{ '--i': 1 } as CSSProperties}>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {row('date', formatDay(localDate(doc.date), lang))}
          {row(doc.kind === 'receipt' ? 'toWarehouse' : 'fromWarehouse', name(doc.warehouse_id))}
          {doc.kind === 'transfer' && row('toWarehouse', name(doc.to_warehouse_id))}
          {doc.supplier_id &&
            row(
              'supplier',
              <Link to="/stock/suppliers/$supplierId" params={{ supplierId: String(doc.supplier_id) }} className="font-medium underline-offset-4 hover:underline">
                {doc.supplier_name}
              </Link>,
            )}
          {doc.exchange_rate && doc.currency && row('exchangeRate', `1 ${doc.currency} = ${formatDecimal(doc.exchange_rate)} ${currencyLabel('UZS', lang)}`)}
          {row('note', doc.note ?? '')}
        </dl>
      </section>

      <section className={`glass rise overflow-hidden ${doc.cancelled ? 'opacity-70' : ''}`} style={{ '--i': 2 } as CSSProperties} aria-label={t('linesCount')}>
        <table className="w-full table-fixed text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-(--line)">
              <th scope="col" className="w-10 px-4 py-3 font-medium">#</th>
              <th scope="col" className="px-4 py-3 font-medium">{t('product')}</th>
              <th scope="col" className="w-32 px-4 py-3 text-right font-medium">{t('quantity')}</th>
              {withPrices && <th scope="col" className="hidden w-36 px-4 py-3 text-right font-medium sm:table-cell">{t('price')}</th>}
              {withPrices && <th scope="col" className="hidden w-40 px-4 py-3 text-right font-medium md:table-cell">{t('sum')}</th>}
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={l.id} className="border-b border-(--line) last:border-0">
                <td className="px-4 py-3 text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="truncate px-4 py-3">{l.product_name}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {formatDecimal(l.quantity)} <span className="text-xs text-muted-foreground">{t(`unit_${l.unit}` as Key)}</span>
                </td>
                {withPrices && <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">{l.price ? formatAmount(l.price) : '—'}</td>}
                {withPrices && (
                  <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
                    {l.price ? formatAmount((Number(l.quantity) * Number(l.price)).toFixed(2)) : '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {withPrices && doc.currency && (
          <p className="border-t border-(--line) px-4 py-3 text-right text-sm">
            {t(doc.supplier_id ? 'purchaseTotal' : 'total')}: <strong className="tabular-nums">{formatAmount(doc.total ?? sum.toFixed(2))} {currencyLabel(doc.currency, lang)}</strong>
          </p>
        )}
      </section>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent closeLabel={t('close')} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('cancelDocQ')}</DialogTitle>
            <DialogDescription>{t('cancelDocText')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>{t('keepDoc')}</Button>
            <Button variant="destructive" disabled={cancelDocument.isPending} onClick={cancel}>{t('cancelDoc')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
