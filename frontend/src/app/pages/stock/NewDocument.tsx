// A new stock document: a receipt (goods arrive), a write-off (goods leave) or a transfer between
// warehouses. Each line shows what the warehouse has now; taking more than that is allowed, with a
// warning, because goods are often sold before their arrival is entered. Saving posts it for good:
// a mistake is undone by cancelling the document, not by editing it.
import { useState, type CSSProperties, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { AlertCircle, Plus, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import Field from '../../Field'
import type { Key } from '../../i18n'
import { CURRENCIES, currencyLabel, formatAmount, formatDecimal, parseAmount, parsePositive } from '../../money'
import { PageHeader } from '../../Page'
import { usePrefs } from '../../prefs'
import type { Product } from '../../products'
import ProductPicker from '../../ProductPicker'
import { balancesQuery, KIND_LABEL, useStockMutations, warehousesQuery, type Kind } from '../../stock'

const route = getRouteApi('/app/stock/documents/new')
const INTRO: Record<Kind, Key> = { receipt: 'receiptIntro', write_off: 'writeOffIntro', transfer: 'transferIntro' }

type Line = { key: number; product: Product | null; quantity: string; price: string }
let nextKey = 1
const blankLine = (): Line => ({ key: nextKey++, product: null, quantity: '', price: '' })
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function NewDocument() {
  const { kind } = route.useSearch()
  const warehouses = useQuery(warehousesQuery)
  // the form starts from the warehouses, so it waits for them; a new kind starts a new form
  if (!warehouses.data) return null
  return <Form key={kind} kind={kind} />
}

function Form({ kind }: { kind: Kind }) {
  const { t, lang } = usePrefs()
  const navigate = useNavigate()
  const { createDocument } = useStockMutations()
  const active = (useQuery(warehousesQuery).data ?? []).filter((w) => !w.archived)
  const main = active.find((w) => w.is_default) ?? active[0]

  const [date, setDate] = useState(today)
  const [from, setFrom] = useState(main?.id ?? 0)
  const [to, setTo] = useState(active.find((w) => w.id !== main?.id)?.id ?? 0)
  const [currency, setCurrency] = useState('UZS')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>(() => [blankLine()])
  const [bad, setBad] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState(false)

  const ids = [...new Set(lines.flatMap((l) => (l.product ? [l.product.id] : [])))]
  const balances = useQuery(balancesQuery(ids)).data ?? {}
  const have = (productId: number) => balances[productId]?.[from] ?? '0'
  const takes = kind !== 'receipt'
  const withPrices = kind === 'receipt'

  const setLine = (key: number, change: Partial<Line>) => {
    setLines(lines.map((l) => (l.key === key ? { ...l, ...change } : l)))
    setBad(new Set([...bad].filter((b) => !b.startsWith(`${key}-`) && b !== 'lines')))
  }

  // how much of a product all lines of this document take from the warehouse so far
  const taken = (productId: number) =>
    lines.filter((l) => l.product?.id === productId).reduce((n, l) => n + (Number(parsePositive(l.quantity, 3)) || 0), 0)

  let sum = 0
  for (const l of lines) sum += (Number(parsePositive(l.quantity, 3)) || 0) * (Number(parseAmount(l.price)) || 0)

  function submit(e: FormEvent) {
    e.preventDefault()
    const errors = new Set<string>()
    const filled = lines.filter((l) => l.product || l.quantity.trim() || l.price.trim())
    const out = filled.map((l) => {
      const quantity = parsePositive(l.quantity, 3)
      const price = withPrices ? parseAmount(l.price) : null
      if (!l.product) errors.add(`${l.key}-product`)
      if (!quantity) errors.add(`${l.key}-quantity`)
      if (price === undefined) errors.add(`${l.key}-price`)
      return { product_id: l.product?.id ?? 0, quantity: quantity ?? '', price: price ?? null }
    })
    if (out.length === 0) errors.add('lines')
    if (kind === 'transfer' && (!to || to === from)) errors.add('to')
    if (errors.size) return setBad(errors)
    setFailed(false)
    createDocument.mutate(
      {
        kind,
        date,
        warehouse_id: from,
        to_warehouse_id: kind === 'transfer' ? to : null,
        currency: out.some((l) => l.price) ? currency : null,
        note,
        lines: out,
      },
      {
        onSuccess: (doc) => {
          toast.success(t('posted'))
          if (doc.negative.length)
            toast.warning(t('wentNegative'), {
              description: doc.negative.map((n) => `${n.product_name}: ${formatDecimal(n.quantity)}`).join(', '),
              duration: 10_000,
            })
          navigate({ to: '/stock/documents/$documentId', params: { documentId: String(doc.id) }, replace: true })
        },
        onError: () => setFailed(true),
      },
    )
  }

  const warehouseSelect = (id: string, label: Key, value: number, onChange: (v: number) => void, invalid = false) => (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{t(label)}</Label>
      <Select value={value ? String(value) : undefined} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {active.map((w) => (
            <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader title={t(KIND_LABEL[kind])} description={t(INTRO[kind])} />

      <section className="glass rise mb-4 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4" style={{ '--i': 1 } as CSSProperties}>
        <Field id="doc-date" label={t('date')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value || today())} max="9999-12-31" />
        </Field>
        {warehouseSelect('doc-from', kind === 'receipt' ? 'toWarehouse' : 'fromWarehouse', from, setFrom)}
        {kind === 'transfer' && warehouseSelect('doc-to', 'toWarehouse', to, (v) => { setTo(v); setBad(new Set([...bad].filter((b) => b !== 'to'))) }, bad.has('to'))}
        {withPrices && (
          <div className="grid content-start gap-1.5">
            <Label htmlFor="doc-currency">{t('currency')}</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="doc-currency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>{c === 'UZS' ? `UZS · ${currencyLabel(c, lang)}` : c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="sm:col-span-2 lg:col-span-4">
          <Field id="doc-note" label={t('note')} optional={t('optional')}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={1} />
          </Field>
        </div>
      </section>

      <section className="glass rise grid gap-1 p-3 sm:p-5" style={{ '--i': 2 } as CSSProperties} aria-label={t('linesCount')}>
        <div className={`hidden gap-3 px-1 pb-1 text-xs text-muted-foreground sm:grid ${withPrices ? 'sm:grid-cols-[minmax(0,1fr)_8rem_9rem_8rem_2.25rem]' : 'sm:grid-cols-[minmax(0,1fr)_9rem_9rem_2.25rem]'}`}>
          <span>{t('product')}</span>
          <span className="text-right">{t('quantity')}</span>
          {withPrices && <span className="text-right">{t('priceOptional')}</span>}
          <span className="text-right">{withPrices ? t('sum') : t('available')}</span>
          <span />
        </div>

        {lines.map((l, i) => {
          const qty = Number(parsePositive(l.quantity, 3)) || 0
          const stock = l.product ? Number(have(l.product.id)) : null
          const short = takes && l.product && qty > 0 && taken(l.product.id) > (stock ?? 0)
          const lineSum = qty * (Number(parseAmount(l.price)) || 0)
          return (
            <div key={l.key} className="grid gap-x-3 gap-y-2 border-b border-(--line) py-2 last:border-0 sm:border-0 sm:py-1">
              <div className={`grid grid-cols-2 items-center gap-2 sm:gap-3 ${withPrices ? 'sm:grid-cols-[minmax(0,1fr)_8rem_9rem_8rem_2.25rem]' : 'sm:grid-cols-[minmax(0,1fr)_9rem_9rem_2.25rem]'}`}>
                <div className="col-span-2 flex gap-2 sm:col-span-1">
                  <div className="min-w-0 flex-1">
                    <ProductPicker
                      id={`line-${l.key}-product`}
                      value={l.product}
                      invalid={bad.has(`${l.key}-product`)}
                      autoFocus={i === lines.length - 1 && i > 0}
                      onChange={(product) => setLine(l.key, { product })}
                    />
                  </div>
                  <Button type="button" size="icon" variant="ghost" className="sm:hidden" aria-label={`${t('removeLine')} ${i + 1}`} onClick={() => setLines(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : [blankLine()])}>
                    <X aria-hidden="true" />
                  </Button>
                </div>
                <div className="relative">
                  <Input
                    value={l.quantity}
                    onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={`${t('quantity')} ${i + 1}`}
                    placeholder={t('quantity')}
                    aria-invalid={bad.has(`${l.key}-quantity`) || undefined}
                    className="pr-14 text-right tabular-nums"
                  />
                  {l.product && (
                    <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-xs text-muted-foreground">{t(`unit_${l.product.unit}` as Key)}</span>
                  )}
                </div>
                {withPrices && (
                  <div className="relative">
                    <Input
                      value={l.price}
                      onChange={(e) => setLine(l.key, { price: e.target.value })}
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label={`${t('price')} ${i + 1}`}
                      placeholder={t('price')}
                      aria-invalid={bad.has(`${l.key}-price`) || undefined}
                      className="pr-14 text-right tabular-nums"
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-xs text-muted-foreground">{currencyLabel(currency, lang)}</span>
                  </div>
                )}
                <span className={`text-right text-sm tabular-nums ${withPrices ? 'col-span-2 sm:col-span-1' : ''} ${short ? 'font-medium text-red' : 'text-muted-foreground'}`}>
                  {withPrices
                    ? lineSum > 0 && formatAmount(lineSum.toFixed(2))
                    : stock !== null && (
                        <>
                          <span className="sm:hidden">{t('available')}: </span>
                          {formatDecimal(String(stock))}
                        </>
                      )}
                </span>
                <Button type="button" size="icon" variant="ghost" className="hidden sm:inline-flex" aria-label={`${t('removeLine')} ${i + 1}`} onClick={() => setLines(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : [blankLine()])}>
                  <X aria-hidden="true" />
                </Button>
              </div>
              {short && (
                <p className="flex items-center gap-1.5 px-1 text-xs text-red">
                  <TriangleAlert className="size-3.5 flex-none" aria-hidden="true" />
                  {t('notEnough')} ({t('available')}: {formatDecimal(String(stock ?? 0))})
                </p>
              )}
              {[...bad].some((b) => b.startsWith(`${l.key}-`)) && (
                <p className="flex items-center gap-1.5 px-1 text-xs text-red">
                  <AlertCircle className="size-3.5 flex-none" aria-hidden="true" />
                  {bad.has(`${l.key}-product`) ? t('chooseProduct') : bad.has(`${l.key}-quantity`) ? t('invalidQuantity') : t('invalidPrice')}
                </p>
              )}
            </div>
          )
        })}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setLines([...lines, blankLine()])}>
            <Plus aria-hidden="true" /> {t('addLine')}
          </Button>
          {withPrices && sum > 0 && (
            <span className="text-sm">
              {t('total')}: <strong className="tabular-nums">{formatAmount(sum.toFixed(2))} {currencyLabel(currency, lang)}</strong>
            </span>
          )}
        </div>
        {bad.has('lines') && <p className="px-1 text-sm text-red">{t('noLines')}</p>}
      </section>

      {failed && (
        <p role="alert" className="mt-4 flex items-center gap-2 rounded-2xl bg-red/10 px-3.5 py-2.5 text-sm text-red">
          <AlertCircle className="size-4 flex-none" aria-hidden="true" />
          {t('notSaved')}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button asChild type="button" variant="ghost">
          <Link to="/stock/documents">{t('cancel')}</Link>
        </Button>
        <Button type="submit" disabled={createDocument.isPending}>
          {t('postDocument')}
        </Button>
      </div>
    </form>
  )
}
