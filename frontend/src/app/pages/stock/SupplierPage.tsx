// One supplier: who they are, what we owe them, the goods that arrived from them and what we
// paid. A new arrival starts from here with the supplier already chosen.
import { useState, type CSSProperties, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { Archive, ArchiveRestore, ArrowLeft, Ban, Banknote, Pencil, PlusCircle, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '../../api'
import { formatDay, localDate } from '../../dates'
import { METHOD_LABEL } from '../../debts'
import { formatMoney } from '../../money'
import { EmptyState, PageHeader } from '../../Page'
import { usePrefs } from '../../prefs'
import { useCan } from '../../session'
import { supplierArrivals, supplierPayments, supplierQuery, useSupplierMutations, type Supplier, type SupplierPayment } from '../../suppliers'
import { Tile } from './Balances'
import SupplierForm from './SupplierForm'
import SupplierPayDialog from './SupplierPayDialog'

const route = getRouteApi('/app/stock/suppliers/$supplierId')

export default function SupplierPage() {
  const { t } = usePrefs()
  const { supplierId } = route.useParams()
  const query = useQuery(supplierQuery(Number(supplierId)))
  const back = (
    <Link to="/stock/suppliers" className="rise mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-(--text)">
      <ArrowLeft className="size-4" aria-hidden="true" /> {t('backToSuppliers')}
    </Link>
  )
  if (query.isPending)
    return (
      <div aria-busy="true">
        {back}
        <Skeleton className="mb-6 h-9 w-72 rounded-xl" />
        <Skeleton className="h-64 rounded-(--radius)" />
      </div>
    )
  if (query.isError) {
    const missing = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 422)
    return (
      <>
        {back}
        <EmptyState
          icon={<Tile icon={Truck} color="var(--violet)" />}
          title={t(missing ? 'supplierNotFound' : 'offline')}
          text=""
          action={!missing && <Button variant="secondary" onClick={() => query.refetch()}>{t('retry')}</Button>}
        />
      </>
    )
  }
  return (
    <>
      {back}
      <Loaded supplier={query.data} />
    </>
  )
}

function Loaded({ supplier: s }: { supplier: Supplier }) {
  const { t, lang } = usePrefs()
  const can = useCan()
  const money = can('money.read')
  const { update } = useSupplierMutations()
  const [editing, setEditing] = useState(false)
  const [paying, setPaying] = useState(false)
  const arrivals = useQuery(supplierArrivals(s.id))
  const payments = useQuery({ ...supplierPayments(s.id), enabled: money })

  const setArchived = (archived: boolean, undoable = true) =>
    update.mutate(
      { id: s.id, archived },
      {
        onSuccess: () =>
          toast.success(t(archived ? 'archivedToast' : 'restoredToast'), {
            action: undoable ? { label: t('undo'), onClick: () => setArchived(!archived, false) } : undefined,
          }),
        onError: () => toast.error(t('notSaved')),
      },
    )

  const row = (label: string, value: ReactNode) => (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value || '—'}</dd>
    </div>
  )

  return (
    <>
      <PageHeader
        title={<span className="break-words">{s.name}</span>}
        description={s.archived && <Badge variant="secondary">{t('archived')}</Badge>}
        actions={
          <>
            {can('stock.write') && (
              <>
                <Button variant="ghost" disabled={update.isPending} onClick={() => setArchived(!s.archived)}>
                  {s.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                  {t(s.archived ? 'restore' : 'archive')}
                </Button>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden="true" /> {t('edit')}
                </Button>
              </>
            )}
            {can('money.write') && (
              <Button variant="outline" onClick={() => setPaying(true)}>
                <Banknote aria-hidden="true" /> {t('paySupplier')}
              </Button>
            )}
            {can('stock.write') && !s.archived && (
              <Button asChild>
                <Link to="/stock/documents/new" search={{ kind: 'receipt', supplier: s.id }}>
                  <PlusCircle aria-hidden="true" /> {t('newArrival')}
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid gap-4">
          {money && (
            <section className="glass rise p-5" style={{ '--i': 1 } as CSSProperties} aria-labelledby="supplier-owed">
              <h2 id="supplier-owed" className="text-sm text-muted-foreground">{t('weOwe')}</h2>
              {s.balances.length === 0 ? (
                <p className="mt-1 text-2xl font-semibold">{t('weOweNothing')}</p>
              ) : (
                s.balances.map((b) => (
                  <p key={b.currency} className="mt-1 text-2xl font-semibold tabular-nums">
                    {formatMoney(Number(b.owed) < 0 ? b.owed.slice(1) : b.owed, b.currency, lang)}
                    {Number(b.owed) < 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">{t('wePaidAhead')}</span>}
                  </p>
                ))
              )}
            </section>
          )}

          <section className="glass rise overflow-hidden" style={{ '--i': 2 } as CSSProperties} aria-labelledby="supplier-arrivals">
            <h2 id="supplier-arrivals" className="px-5 pt-5 pb-3 text-lg font-semibold">{t('arrivals')}</h2>
            {arrivals.isPending ? (
              <Skeleton className="m-5 h-24 rounded-xl" />
            ) : (arrivals.data?.items.length ?? 0) === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">{t('noArrivals')}</p>
            ) : (
              <table className="w-full table-fixed text-sm">
                <tbody>
                  {arrivals.data!.items.map((d) => (
                    <tr key={d.id} className={`relative border-t border-(--line) transition-colors hover:bg-(--soft) ${d.cancelled ? 'text-muted-foreground' : ''}`}>
                      <td className="px-5 py-3">
                        <Link
                          to="/stock/documents/$documentId"
                          params={{ documentId: String(d.id) }}
                          className="font-medium after:absolute after:inset-0 focus-visible:outline-none after:focus-visible:rounded-lg after:focus-visible:outline-2 after:focus-visible:outline-(--accent)"
                        >
                          {t('kindReceipt')} № {d.number}
                        </Link>
                        {d.cancelled && <Badge variant="secondary" className="ml-2">{t('cancelledBadge')}</Badge>}
                        <span className="block text-xs text-muted-foreground">{formatDay(localDate(d.date), lang)}</span>
                      </td>
                      <td className={`w-44 px-5 py-3 text-right whitespace-nowrap tabular-nums ${d.cancelled ? 'line-through' : ''}`}>
                        {d.total && d.currency ? formatMoney(d.total, d.currency, lang) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {money && (
            <section className="glass rise overflow-hidden" style={{ '--i': 3 } as CSSProperties} aria-labelledby="supplier-payments">
              <h2 id="supplier-payments" className="px-5 pt-5 pb-3 text-lg font-semibold">{t('paymentsTab')}</h2>
              {payments.isPending ? (
                <Skeleton className="m-5 h-24 rounded-xl" />
              ) : (payments.data?.items.length ?? 0) === 0 ? (
                <p className="px-5 pb-5 text-sm text-muted-foreground">{t('noSupplierPayments')}</p>
              ) : (
                <ul>
                  {payments.data!.items.map((p) => (
                    <PaymentRow key={p.id} payment={p} />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <section className="glass rise p-5" style={{ '--i': 2 } as CSSProperties} aria-labelledby="supplier-details">
          <h2 id="supplier-details" className="mb-3 text-lg font-semibold">{t('details')}</h2>
          <dl className="grid gap-3">
            {row(t('inn'), s.inn)}
            {row(t('phone'), s.phone && <a href={`tel:${s.phone}`} className="hover:underline">{s.phone}</a>)}
            {row(t('address'), s.address)}
            {row(t('note'), s.note)}
          </dl>
        </section>
      </div>

      <SupplierForm open={editing} onOpenChange={setEditing} supplier={s} />
      <SupplierPayDialog open={paying} onOpenChange={setPaying} supplier={s} />
    </>
  )
}

// A payment with its own cancel: asked twice, since a cancelled payment can't be brought back.
function PaymentRow({ payment: p }: { payment: SupplierPayment }) {
  const { t, lang } = usePrefs()
  const can = useCan()
  const { cancelPayment } = useSupplierMutations()
  const [asking, setAsking] = useState(false)
  const cancelled = !!p.cancelled_at
  return (
    <li className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-(--line) px-5 py-3 text-sm ${cancelled ? 'text-muted-foreground' : ''}`}>
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {t('payment')} № {p.number}
          {cancelled && <Badge variant="secondary" className="ml-2">{t('cancelledBadge')}</Badge>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {formatDay(localDate(p.date), lang)} · {t(METHOD_LABEL[p.method])}
          {p.note && ` · ${p.note}`}
        </p>
      </div>
      <span className={`whitespace-nowrap tabular-nums ${cancelled ? 'line-through' : ''}`}>{formatMoney(p.amount, p.currency, lang)}</span>
      {!cancelled &&
        can('money.write') &&
        (asking ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={cancelPayment.isPending}
            onClick={() =>
              cancelPayment.mutate(p.id, {
                onSuccess: () => toast.success(t('paymentCancelled')),
                onError: () => toast.error(t('notSaved')),
              })
            }
          >
            {t('confirmCancelPayment')}
          </Button>
        ) : (
          <Button size="icon" variant="ghost" aria-label={`${t('cancelDoc')}: ${t('payment')} № ${p.number}`} onClick={() => setAsking(true)}>
            <Ban aria-hidden="true" />
          </Button>
        ))}
    </li>
  )
}
