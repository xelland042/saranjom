// A stock count: every active product with what one warehouse should hold, and a box for what was
// found. Finishing writes the differences as a receipt (found over) and a write-off (missing).
// What is typed stays in this browser until the count is finished, so a closed tab loses nothing.
// The page prints as a count sheet: empty boxes to fill in by hand.
import { memo, useCallback, useEffect, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { ArrowLeft, ClipboardCheck, Printer, Search, SearchX } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiError } from '../../api'
import { formatDecimal } from '../../money'
import { EmptyState, PageHeader } from '../../Page'
import { usePrefs } from '../../prefs'
import { useCan } from '../../session'
import { countSheet, KIND_LABEL, useStockMutations, warehousesQuery, type CountDoc, type StockRow } from '../../stock'
import { Qty, Tile } from './Balances'

const route = getRouteApi('/app/stock/count')
type Typed = Record<string, string> // product id -> what was typed
type Show = 'all' | 'entered' | 'differing'

// "12,5" or "1 200" as the API's "12.5", "1200"; undefined when it isn't a quantity (zero is one)
const parse = (typed: string) => {
  const s = typed.replace(/[\s  ]/g, '').replace(',', '.')
  return /^\d{1,12}(\.\d{1,3})?$/.test(s) ? s : undefined
}
const draftKey = (warehouseId: number) => `stock-count:${warehouseId}`
function draft(warehouseId: number): Typed {
  try {
    return JSON.parse(localStorage.getItem(draftKey(warehouseId)) ?? '{}')
  } catch {
    return {}
  }
}

const Row = memo(function Row({ row, typed, onType }: { row: StockRow; typed: string; onType: (id: number, v: string) => void }) {
  const { t } = usePrefs()
  const counted = typed ? parse(typed) : undefined
  const diff = counted === undefined ? null : Math.round((Number(counted) - Number(row.total)) * 1000) / 1000
  return (
    <tr className="border-b border-(--line) last:border-0">
      <td className="px-4 py-2.5">
        {/* on a phone the whole name shows: two products often differ only at the end */}
        <span className="block font-medium break-words sm:truncate">{row.name}</span>
        {row.sku && <span className="block truncate text-xs text-muted-foreground sm:hidden">{row.sku}</span>}
      </td>
      <td className="hidden truncate px-4 py-2.5 text-muted-foreground sm:table-cell">{row.sku ?? '—'}</td>
      <td className="px-4 py-2.5 text-right whitespace-nowrap">
        <Qty value={row.total} unit={row.unit} />
      </td>
      <td className="px-2 py-1.5">
        <Input
          inputMode="decimal"
          autoComplete="off"
          className="h-9 text-right tabular-nums"
          aria-label={`${t('countCounted')}: ${row.name}`}
          aria-invalid={(typed !== '' && counted === undefined) || undefined}
          value={typed}
          onChange={(e) => onType(row.product_id, e.target.value)}
        />
      </td>
      <td className={`hidden px-4 py-2.5 text-right whitespace-nowrap tabular-nums md:table-cell print:hidden ${diff === null || diff === 0 ? 'text-muted-foreground' : diff < 0 ? 'font-medium text-red' : 'font-medium text-green'}`}>
        {diff === null ? '' : diff === 0 ? '0' : `${diff > 0 ? '+' : ''}${formatDecimal(String(diff))}`}
      </td>
    </tr>
  )
})

function Sheet({ warehouseId }: { warehouseId: number }) {
  const { t } = usePrefs()
  const can = useCan()
  const sheet = useQuery(countSheet(warehouseId))
  const { count } = useStockMutations()
  const [typed, setTyped] = useState<Typed>(() => draft(warehouseId))
  const [q, setQ] = useState('')
  const [show, setShow] = useState<Show>('all')
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<CountDoc[] | null>(null)

  useEffect(() => {
    try {
      if (Object.keys(typed).length) localStorage.setItem(draftKey(warehouseId), JSON.stringify(typed))
      else localStorage.removeItem(draftKey(warehouseId))
    } catch {
      // a private window: the count still works, it just isn't kept
    }
  }, [typed, warehouseId])

  const onType = useCallback((id: number, v: string) => {
    setDone(null)
    setConfirming(false)
    setTyped((old) => {
      const next = { ...old }
      if (v) next[id] = v
      else delete next[id]
      return next
    })
  }, [])

  const rows = sheet.data ?? []
  const entered = rows.filter((r) => typed[r.product_id])
  const lines = entered.flatMap((r) => {
    const counted = parse(typed[r.product_id])
    return counted === undefined ? [] : [{ product_id: r.product_id, expected: r.total, counted }]
  })
  const invalid = entered.length - lines.length
  const differing = lines.filter((l) => Number(l.counted) !== Number(l.expected)).length
  const differs = (r: StockRow) => {
    const counted = parse(typed[r.product_id] ?? '')
    return counted !== undefined && Number(counted) !== Number(r.total)
  }
  // shortcut: plain text matching, so Latin doesn't find Cyrillic here as the server's search does;
  // ask the server for the matching ids if people count with a list in the other script
  const needle = q.trim().toLowerCase()
  const visible = rows.filter(
    (r) => (!needle || `${r.name} ${r.sku ?? ''}`.toLowerCase().includes(needle)) && (show === 'all' || (show === 'entered' ? !!typed[r.product_id] : differs(r))),
  )

  function finish() {
    count.mutate(
      { warehouse_id: warehouseId, note: t('stockCount'), lines },
      {
        onSuccess: (r) => {
          setTyped({})
          setConfirming(false)
          setShow('all')
          setDone(r.documents)
          toast.success(t('countDone'))
        },
        onError: (e) => {
          setConfirming(false)
          // stock moved while the count was typed in: show the new numbers and let them look again
          if (e instanceof ApiError && e.status === 409) {
            sheet.refetch()
            toast.error(t('countMoved'))
          } else toast.error(t('notSaved'))
        },
      },
    )
  }

  let body
  if (sheet.isPending) {
    body = (
      <div className="grid gap-3 p-4" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 rounded-xl" />
        ))}
      </div>
    )
  } else if (sheet.isError) {
    body = (
      <div className="grid justify-items-center gap-3 px-6 py-14 text-center">
        <p>{t('offline')}</p>
        <Button variant="secondary" onClick={() => sheet.refetch()}>{t('retry')}</Button>
      </div>
    )
  } else if (visible.length === 0) {
    body = <EmptyState bare icon={<Tile icon={SearchX} />} title={t('nothingFound')} text={rows.length ? t('countNothingShown') : t('noProductsText')} />
  } else {
    body = (
      <table className="w-full table-fixed text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b border-(--line)">
            <th scope="col" className="px-4 py-3 font-medium">{t('product')}</th>
            <th scope="col" className="hidden w-32 px-4 py-3 font-medium sm:table-cell">{t('sku')}</th>
            <th scope="col" className="w-24 px-4 py-3 text-right font-medium sm:w-36">{t('countExpected')}</th>
            <th scope="col" className="w-24 px-4 py-3 text-right font-medium sm:w-32">{t('countCounted')}</th>
            <th scope="col" className="hidden w-28 px-4 py-3 text-right font-medium md:table-cell print:hidden">{t('countDiff')}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <Row key={r.product_id} row={r} typed={typed[r.product_id] ?? ''} onType={onType} />
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <>
      <div className="rise mb-4 flex flex-wrap items-center gap-3 print:hidden" style={{ '--i': 2 } as CSSProperties}>
        <div className="relative min-w-0 flex-1 basis-64">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('countSearch')} aria-label={t('countSearch')} className="pl-10" />
        </div>
        <Tabs value={show} onValueChange={(v) => setShow(v as Show)}>
          <TabsList>
            <TabsTrigger value="all">{t('showAll')}</TabsTrigger>
            <TabsTrigger value="entered">{t('countEntered')}</TabsTrigger>
            <TabsTrigger value="differing">{t('countDiffering')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {done && (
        <section className="glass rise mb-4 p-5 text-sm print:hidden" role="status" aria-labelledby="count-done">
          <h2 id="count-done" className="flex items-center gap-2 font-semibold">
            <ClipboardCheck className="size-4 flex-none text-green" aria-hidden="true" /> {t('countDone')}
          </h2>
          {done.length === 0 ? (
            <p className="mt-1 text-muted-foreground">{t('countSame')}</p>
          ) : (
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              <span className="text-muted-foreground">{t('countDocs')}:</span>
              {done.map((d) => (
                <Link key={d.id} to="/stock/documents/$documentId" params={{ documentId: String(d.id) }} className="font-medium underline-offset-4 hover:underline">
                  {t(KIND_LABEL[d.kind])} №{d.number}
                </Link>
              ))}
            </p>
          )}
        </section>
      )}
      <section className="glass rise overflow-hidden" style={{ '--i': 3 } as CSSProperties} aria-label={t('stockCount')}>
        {body}
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--line) px-4 py-3 text-sm print:hidden">
            <span className="text-muted-foreground" aria-live="polite">
              {t('countEntered')}: <strong className="text-(--text) tabular-nums">{lines.length}</strong> {t('of')} {rows.length} · {t('countDiffering')}:{' '}
              <strong className="text-(--text) tabular-nums">{differing}</strong>
              {invalid > 0 && <span className="ml-3 text-red">{t('countInvalid')}: {invalid}</span>}
            </span>
            {can('stock.write') &&
              (confirming ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span>
                    {t('countWillChange')}: <strong className="tabular-nums">{differing}</strong>
                  </span>
                  <Button variant="secondary" onClick={() => setConfirming(false)}>{t('cancel')}</Button>
                  <Button onClick={finish} disabled={count.isPending}>{t('countYes')}</Button>
                </span>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  {entered.length > 0 && (
                    <Button variant="ghost" onClick={() => setTyped({})}>{t('countClear')}</Button>
                  )}
                  <Button onClick={() => setConfirming(true)} disabled={lines.length === 0 || invalid > 0}>
                    <ClipboardCheck aria-hidden="true" /> {t('countFinish')}
                  </Button>
                </span>
              ))}
          </div>
        )}
      </section>
      <p className="rise mt-3 px-1 text-xs text-muted-foreground print:hidden" style={{ '--i': 4 } as CSSProperties}>{t('countDraftNote')}</p>
    </>
  )
}

export default function Count() {
  const { t } = usePrefs()
  const { warehouse } = route.useSearch()
  const navigate = route.useNavigate()
  const warehouses = useQuery(warehousesQuery)
  const active = (warehouses.data ?? []).filter((w) => !w.archived)
  const chosen = active.find((w) => w.id === warehouse) ?? active.find((w) => w.is_default) ?? active[0]
  return (
    <>
      <Link to="/stock" className="rise mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-(--text) print:hidden">
        <ArrowLeft className="size-4" aria-hidden="true" /> {t('backToStock')}
      </Link>
      <PageHeader
        title={
          <>
            {t('stockCount')}
            {chosen && <span className="hidden text-muted-foreground print:inline"> · {chosen.name}</span>}
          </>
        }
        description={<span className="print:hidden">{t('stockCountIntro')}</span>}
        actions={
          <span className="flex flex-wrap gap-2 print:hidden">
            {chosen && active.length > 1 && (
              <Select value={String(chosen.id)} onValueChange={(v) => navigate({ search: { warehouse: Number(v) }, replace: true })}>
                <SelectTrigger className="w-48" aria-label={t('warehouse')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {active.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" onClick={() => window.print()}>
              <Printer aria-hidden="true" /> {t('print')}
            </Button>
          </span>
        }
      />
      {chosen && <Sheet key={chosen.id} warehouseId={chosen.id} />}
    </>
  )
}
