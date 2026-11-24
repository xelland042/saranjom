// One product: its stock (in total and per warehouse), prices, details, every movement of its
// stock (receipts, write-offs, transfers, sales) and its history.
import { useState, type CSSProperties, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { Archive, ArchiveRestore, ArrowLeft, PackageX, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '../../api'
import { formatDay, localDate } from '../../dates'
import { formatDecimal, formatMoney } from '../../money'
import { EmptyState, PageHeader } from '../../Page'
import { usePrefs } from '../../prefs'
import { categoriesQuery, movementsQuery, priceListsQuery, productQuery, useEquivalent, useProductMutations, type Movement, type Product } from '../../products'
import { balancesQuery, KIND_LABEL, warehousesQuery } from '../../stock'
import Timeline from '../../Timeline'
import { Tile } from '../stock/Balances'
import ProductForm from './ProductForm'
import { useCan } from '../../session'

const route = getRouteApi('/app/products/$productId')

export default function ProductPage() {
  const { t } = usePrefs()
  const { productId } = route.useParams()
  const query = useQuery(productQuery(Number(productId)))
  const back = (
    <Link to="/products" className="rise mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-(--text)">
      <ArrowLeft className="size-4" aria-hidden="true" /> {t('backToProducts')}
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
          icon={<Tile icon={PackageX} color="var(--violet)" />}
          title={t(missing ? 'productNotFound' : 'offline')}
          text=""
          action={!missing && <Button variant="secondary" onClick={() => query.refetch()}>{t('retry')}</Button>}
        />
      </>
    )
  }
  return (
    <>
      {back}
      <Loaded product={query.data} />
    </>
  )
}

function Loaded({ product: p }: { product: Product }) {
  const { t, lang } = usePrefs()
  const can = useCan()
  const { save } = useProductMutations()
  const [editing, setEditing] = useState(false)
  const per = useQuery(balancesQuery([p.id])).data?.[p.id] ?? {}
  const warehouses = useQuery(warehousesQuery).data ?? []
  const lists = useQuery(priceListsQuery).data ?? []
  const category = useQuery(categoriesQuery).data?.find((c) => c.id === p.category_id)
  const moves = useQuery(movementsQuery(p.id))
  const equivalent = useEquivalent()
  const unit = t(`unit_${p.unit}`)
  const total = Object.values(per).reduce((s, q) => s + Number(q), 0)
  const low = p.min_stock !== null && total < Number(p.min_stock)
  const place = (id: number | null) => warehouses.find((w) => w.id === id)?.name ?? ''

  const setArchived = (archived: boolean) =>
    save.mutate({ id: p.id, archived }, { onSuccess: () => toast.success(t(archived ? 'archivedToast' : 'restoredToast')), onError: () => toast.error(t('notSaved')) })

  const row = (label: string, value: ReactNode, key: string | number = label) => (
    <div key={key} className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value || '—'}</dd>
    </div>
  )

  return (
    <>
      <PageHeader
        title={<span className="break-words">{p.name}</span>}
        description={p.archived && <Badge variant="secondary">{t('archived')}</Badge>}
        actions={
          can('products.write') && (
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" /> {t('edit')}
            </Button>
            <Button variant="ghost" disabled={save.isPending} onClick={() => setArchived(!p.archived)}>
              {p.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
              {t(p.archived ? 'restore' : 'archive')}
            </Button>
          </>
          )
        }
      />

      <div className="mb-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <section className="glass rise grid content-start gap-2 p-5" style={{ '--i': 1 } as CSSProperties} aria-labelledby="product-stock">
          <h2 id="product-stock" className="text-sm text-muted-foreground">{t('inStock')}</h2>
          <strong className={`text-3xl tabular-nums ${total < 0 ? 'text-red' : low ? 'text-amber' : ''}`}>
            {formatDecimal(total.toFixed(3))} <span className="text-base font-normal text-muted-foreground">{unit}</span>
          </strong>
          {total < 0 ? (
            <p className="text-sm text-red">{t('belowZero')}</p>
          ) : (
            low && <p className="text-sm text-amber">{t('runningLow')}</p>
          )}
          {p.min_stock !== null && (
            <p className="text-xs text-muted-foreground">
              {t('minStock')}: {formatDecimal(p.min_stock)} {unit}
            </p>
          )}
          <ul className="mt-2 grid gap-1 text-sm">
            {warehouses
              .filter((w) => !w.archived || per[w.id])
              .map((w) => (
                <li key={w.id} className="flex justify-between gap-3 border-t border-(--line) pt-1.5">
                  <span className="truncate text-muted-foreground">{w.name}</span>
                  <span className={`tabular-nums ${Number(per[w.id] ?? 0) < 0 ? 'text-red' : ''}`}>{formatDecimal(per[w.id] ?? '0')}</span>
                </li>
              ))}
          </ul>
        </section>

        <section className="glass rise p-5" style={{ '--i': 2 } as CSSProperties} aria-labelledby="product-details">
          <h2 id="product-details" className="mb-4 text-lg font-semibold">{t('details')}</h2>
          <dl className="grid gap-3">
            {lists
              .filter((l) => !l.archived)
              .map((l) => {
                const amount = p.prices.find((x) => x.price_list_id === l.id)?.amount
                const hint = amount && equivalent(amount, l.currency)
                return row(
                  `${t('priceIn')} ${l.name}`,
                  amount && (
                    <span className="tabular-nums">
                      {formatMoney(amount, l.currency, lang)}
                      {hint && <span className="text-sm text-muted-foreground"> · {hint}</span>}
                    </span>
                  ),
                  l.id,
                )
              })}
            {row(t('sku'), p.sku)}
            {row(t('barcode'), p.barcode && <span className="tabular-nums">{p.barcode}</span>)}
            {row(t('unit'), unit)}
            {row(t('category'), category?.name)}
            {row(t('mxik'), p.mxik && <span className="tabular-nums">{p.mxik}</span>)}
            {row(t('note'), p.note && <span className="whitespace-pre-line">{p.note}</span>)}
          </dl>
        </section>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="glass rise overflow-hidden" style={{ '--i': 3 } as CSSProperties} aria-labelledby="product-moves">
          <h2 id="product-moves" className="px-5 pt-5 pb-2 text-lg font-semibold">{t('movements')}</h2>
          {moves.isPending ? (
            <Skeleton className="m-5 h-24 rounded-xl" />
          ) : !moves.data?.length ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">{t('noMovements')}</p>
          ) : (
            <table className="w-full table-fixed text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b border-(--line)">
                  <th scope="col" className="hidden w-40 px-4 py-2 font-medium sm:table-cell">{t('date')}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{t('document')}</th>
                  <th scope="col" className="hidden w-40 px-4 py-2 font-medium md:table-cell">{t('warehouse')}</th>
                  <th scope="col" className="w-28 px-4 py-2 text-right font-medium">{t('quantity')}</th>
                </tr>
              </thead>
              <tbody>
                {moves.data.map((m) => (
                  <MoveRow key={`${m.kind}-${m.id}`} m={m} place={place} unit={unit} />
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="glass rise p-5" style={{ '--i': 4 } as CSSProperties}>
          <Timeline scope={{ entity: 'product', entityId: p.id }} title={t('history')} />
        </section>
      </div>

      <ProductForm open={editing} onOpenChange={setEditing} product={p} />
    </>
  )
}

function MoveRow({ m, place, unit }: { m: Movement; place: (id: number | null) => string; unit: string }) {
  const { t, lang } = usePrefs()
  // what it did to the total: receipts and returns add, write-offs and sales take away, transfers
  // only move
  const sign = m.kind === 'receipt' || m.kind === 'return' ? '+' : m.kind === 'transfer' ? '' : '−'
  const doc =
    m.kind === 'sale' ? (
      <Link to="/orders/$orderId" params={{ orderId: String(m.id) }} className="hover:underline">
        {t('sale')} № {m.number}
        {m.customer_name && <span className="text-muted-foreground"> · {m.customer_name}</span>}
      </Link>
    ) : m.kind === 'return' ? (
      <Link to="/returns/$returnId" params={{ returnId: String(m.id) }} className="hover:underline">
        {t('returnDoc')} № {m.number}
        {m.customer_name && <span className="text-muted-foreground"> · {m.customer_name}</span>}
      </Link>
    ) : (
      <Link to="/stock/documents/$documentId" params={{ documentId: String(m.id) }} className="hover:underline">
        {t(KIND_LABEL[m.kind])} № {m.number}
      </Link>
    )
  return (
    <tr className="border-b border-(--line) last:border-0">
      <td className="hidden px-4 py-2.5 sm:table-cell">{formatDay(localDate(m.date), lang)}</td>
      <td className="truncate px-4 py-2.5">
        {doc}
        <span className="block text-xs text-muted-foreground sm:hidden">{formatDay(localDate(m.date), lang)}</span>
      </td>
      <td className="hidden truncate px-4 py-2.5 text-muted-foreground md:table-cell">
        {place(m.warehouse_id)}
        {m.to_warehouse_id && ` → ${place(m.to_warehouse_id)}`}
      </td>
      <td className={`px-4 py-2.5 text-right whitespace-nowrap tabular-nums ${sign === '+' ? 'text-green' : ''}`}>
        {sign}
        {formatDecimal(m.quantity)} <span className="text-xs text-muted-foreground">{unit}</span>
      </td>
    </tr>
  )
}
