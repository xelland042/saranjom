// One sales order. A new order or a draft opens in the editor; a confirmed or cancelled one is
// read-only, with print and cancel. Prices come from the order's price list (the customer's, else
// the default) and can be changed per line; they include VAT, whose share is shown apart.
import { useState, type CSSProperties, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { AlertCircle, ArrowLeft, Ban, FileX, Plus, Printer, TriangleAlert, Undo2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, invalidFields } from '../../api'
import { customerQuery, searchCustomers, type CustomerRow } from '../../customers'
import { formatDay, isoToday, localDate } from '../../dates'
import Field from '../../Field'
import type { Key } from '../../i18n'
import { currencyLabel, formatAmount, formatDecimal, formatMoney, parseAmount, parsePositive } from '../../money'
import { orderQuery, payState, STATUS_LABEL, useOrderMutations, vatOn, vatRatesQuery, type Order } from '../../orders'
import { EmptyState, PageHeader } from '../../Page'
import Picker from '../../Picker'
import { usePrefs } from '../../prefs'
import { priceListsQuery, type Product } from '../../products'
import ProductPicker from '../../ProductPicker'
import { useCan, useMe } from '../../session'
import { balancesQuery, warehousesQuery } from '../../stock'
import Timeline from '../../Timeline'
import { Tile } from '../stock/Balances'
import CustomerTasks from '../tasks/CustomerTasks'
import { PayBadge } from './PayBadge'
import ReturnDialog from './ReturnDialog'

const existing = getRouteApi('/app/orders/$orderId')

// what a line costs after its discount, VAT included (the server recomputes it to the cent)
const lineAmount = (quantity: string, price: string, discount: string) =>
  (Number(parsePositive(quantity, 3)) || 0) * (Number(parseAmount(price)) || 0) * (1 - (Number(discount.replace(',', '.')) || 0) / 100)

const fresh = getRouteApi('/app/orders/new')

// ?customer=12 (from a customer's page) starts the order for them
export function NewOrder() {
  const { customer: customerId } = fresh.useSearch()
  const warehouses = useQuery(warehousesQuery)
  const lists = useQuery(priceListsQuery)
  const customer = useQuery({ ...customerQuery(customerId ?? 0), enabled: !!customerId })
  if (!warehouses.data || !lists.data || (customerId && customer.isPending)) return null
  return <Editor start={customer.data} />
}

export function ExistingOrder() {
  const { t } = usePrefs()
  const can = useCan()
  const { orderId } = existing.useParams()
  const order = useQuery(orderQuery(Number(orderId)))
  const warehouses = useQuery(warehousesQuery)
  const lists = useQuery(priceListsQuery)
  const back = (
    <Link to="/orders" className="rise mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-(--text) print:hidden">
      <ArrowLeft className="size-4" aria-hidden="true" /> {t('backToOrders')}
    </Link>
  )
  if (order.isError) {
    const missing = order.error instanceof ApiError && (order.error.status === 404 || order.error.status === 422)
    return (
      <>
        {back}
        <EmptyState
          icon={<Tile icon={FileX} color="var(--violet)" />}
          title={t(missing ? 'orderNotFound' : 'offline')}
          text=""
          action={!missing && <Button variant="secondary" onClick={() => order.refetch()}>{t('retry')}</Button>}
        />
      </>
    )
  }
  if (!order.data || !warehouses.data || !lists.data)
    return (
      <div aria-busy="true">
        {back}
        <Skeleton className="mb-6 h-9 w-72 rounded-xl" />
        <Skeleton className="h-64 rounded-(--radius)" />
      </div>
    )
  return (
    <>
      {back}
      {/* a draft is edited by those who may change orders; everyone else reads it */}
      {order.data.status === 'draft' && can('orders.write') ? <Editor key={order.data.id} order={order.data} /> : <View order={order.data} />}
    </>
  )
}

type Customer = Pick<CustomerRow, 'id' | 'name' | 'price_list_id'>
type Line = { key: number; product: Product | null; quantity: string; price: string; discount: string }
let nextKey = 1
const blankLine = (): Line => ({ key: nextKey++, product: null, quantity: '', price: '', discount: '' })

function Editor({ order, start }: { order?: Order; start?: Customer }) {
  const { t, lang } = usePrefs()
  const navigate = useNavigate()
  const { save, confirm, cancel } = useOrderMutations()
  const warehouses = (useQuery(warehousesQuery).data ?? []).filter((w) => !w.archived || w.id === order?.warehouse_id)
  const lists = (useQuery(priceListsQuery).data ?? []).filter((l) => !l.archived || l.id === order?.price_list_id)
  const vatRates = useQuery(vatRatesQuery).data
  const mainList = lists.find((l) => l.is_default) ?? lists[0]

  const [customer, setCustomer] = useState<Customer | null>(
    order ? { id: order.customer_id, name: order.customer_name, price_list_id: order.price_list_id } : (start ?? null),
  )
  const [date, setDate] = useState(order?.date ?? isoToday())
  const [warehouseId, setWarehouseId] = useState(order?.warehouse_id ?? warehouses.find((w) => w.is_default)?.id ?? 0)
  const [listId, setListId] = useState(order?.price_list_id ?? start?.price_list_id ?? mainList?.id ?? 0)
  const [note, setNote] = useState(order?.note ?? '')
  const [lines, setLines] = useState<Line[]>(() =>
    order?.lines.length
      ? order.lines.map((l) => ({
          key: nextKey++,
          // enough of the product for the picker and the unit; its prices load when it's picked again
          product: { id: l.product_id, name: l.product_name, unit: l.unit, prices: [] } as unknown as Product,
          quantity: formatDecimal(l.quantity),
          price: formatAmount(l.price),
          discount: Number(l.discount) ? formatDecimal(l.discount) : '',
        }))
      : [blankLine()],
  )
  const [bad, setBad] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState<Key | null>(null)
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  const list = lists.find((l) => l.id === listId)
  const currency = list?.currency ?? 'UZS'
  const priceIn = (p: Product, id: number) => p.prices?.find((x) => x.price_list_id === id)?.amount
  const ids = [...new Set(lines.flatMap((l) => (l.product ? [l.product.id] : [])))]
  const balances = useQuery(balancesQuery(ids)).data ?? {}
  const taken = (productId: number) =>
    lines.filter((l) => l.product?.id === productId).reduce((n, l) => n + (Number(parsePositive(l.quantity, 3)) || 0), 0)
  const vat = vatOn(vatRates, date)
  const total = lines.reduce((n, l) => n + lineAmount(l.quantity, l.price, l.discount), 0)
  const vatTotal = vat ? (total * vat) / (100 + vat) : 0
  const busy = save.isPending || confirm.isPending

  const setLine = (key: number, change: Partial<Line>) => {
    setLines(lines.map((l) => (l.key === key ? { ...l, ...change } : l)))
    setBad(new Set([...bad].filter((b) => !b.startsWith(`${key}-`) && b !== 'lines')))
  }
  // a new price list re-prices the lines that have a price in it; the others keep theirs
  const switchList = (id: number) => {
    setListId(id)
    setLines(lines.map((l) => {
      const p = l.product && priceIn(l.product, id)
      return p ? { ...l, price: formatAmount(p) } : l
    }))
  }

  function fields() {
    const errors = new Set<string>()
    if (!customer) errors.add('customer')
    const filled = lines.filter((l) => l.product || l.quantity.trim() || l.price.trim())
    const out = filled.map((l) => {
      const quantity = parsePositive(l.quantity, 3)
      const price = parseAmount(l.price)
      const discount = l.discount.trim() ? l.discount.replace(',', '.').trim() : '0'
      if (!l.product) errors.add(`${l.key}-product`)
      if (!quantity) errors.add(`${l.key}-quantity`)
      if (!price) errors.add(`${l.key}-price`)
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(discount) || Number(discount) > 100) errors.add(`${l.key}-discount`)
      return { product_id: l.product?.id ?? 0, quantity: quantity ?? '', price: price ?? '', discount }
    })
    setBad(errors)
    if (errors.size) return null
    return { customer_id: customer!.id, date, warehouse_id: warehouseId, price_list_id: listId, note, lines: out }
  }

  const onError = (err: unknown) =>
    setFailed(invalidFields(err).has('exchange_rate') ? 'noRateForCurrency' : invalidFields(err).has('lines') ? 'noLines' : 'notSaved')

  async function submit(andConfirm: boolean) {
    const f = fields()
    if (!f) return
    if (andConfirm && f.lines.length === 0) return setBad(new Set(['lines']))
    setFailed(null)
    try {
      let saved = await save.mutateAsync({ id: order?.id, ...f })
      if (andConfirm) {
        saved = await confirm.mutateAsync(saved.id)
        toast.success(t('orderConfirmed'))
        if (saved.negative.length)
          toast.warning(t('wentNegative'), {
            description: saved.negative.map((n) => `${n.product_name}: ${formatDecimal(n.quantity)}`).join(', '),
            duration: 10_000,
          })
        if (saved.credit)
          toast.warning(t('overCreditLimit'), {
            description: `${t('debt')}: ${formatMoney(saved.credit.debt, saved.credit.currency, lang)} · ${t('creditLimit')}: ${formatMoney(saved.credit.limit, saved.credit.currency, lang)}`,
            duration: 10_000,
          })
      } else toast.success(t('draftSaved'))
      if (!order) navigate({ to: '/orders/$orderId', params: { orderId: String(saved.id) }, replace: true })
    } catch (err) {
      onError(err)
    }
  }

  return (
    <form onSubmit={(e) => (e.preventDefault(), submit(false))} noValidate>
      <PageHeader
        title={order ? `${t('order')} № ${order.number}` : t('newOrder')}
        description={order && <Badge variant="secondary">{t('statusDraft')}</Badge>}
        actions={
          order && (
            <Button type="button" variant="ghost" onClick={() => setConfirmingCancel(true)}>
              <Ban aria-hidden="true" /> {t('cancelDoc')}
            </Button>
          )
        }
      />

      <section className="glass rise mb-4 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4" style={{ '--i': 1 } as CSSProperties}>
        <div className="grid content-start gap-1.5 sm:col-span-2">
          <Label htmlFor="order-customer">{t('customer')}</Label>
          <Picker
            id="order-customer"
            value={customer}
            onChange={(c) => {
              setCustomer(c)
              setBad(new Set([...bad].filter((b) => b !== 'customer')))
              switchList(c.price_list_id ?? mainList?.id ?? listId)
            }}
            search={searchCustomers}
            queryKey="customers"
            label={(c) => c.name}
            placeholder={t('chooseCustomer')}
            noMatches={t('noMatches')}
            invalid={bad.has('customer')}
            autoFocus={!order}
          />
          {bad.has('customer') && <p className="text-xs text-red">{t('chooseCustomer')}</p>}
        </div>
        <Field id="order-date" label={t('date')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value || isoToday())} max="9999-12-31" />
        </Field>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="order-warehouse">{t('warehouse')}</Label>
          <Select value={String(warehouseId)} onValueChange={(v) => setWarehouseId(Number(v))}>
            <SelectTrigger id="order-warehouse" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {warehouses.map((w) => (
                <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="order-list">{t('priceList')}</Label>
          <Select value={String(listId)} onValueChange={(v) => switchList(Number(v))}>
            <SelectTrigger id="order-list" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {lists.map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>{`${l.name} · ${currencyLabel(l.currency, lang)}`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <Field id="order-note" label={t('note')} optional={t('optional')}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={1} />
          </Field>
        </div>
      </section>

      <section className="glass rise grid gap-1 p-3 sm:p-5" style={{ '--i': 2 } as CSSProperties} aria-label={t('linesCount')}>
        <div className="hidden grid-cols-[minmax(0,1fr)_7rem_9rem_6rem_9rem_2.25rem] gap-3 px-1 pb-1 text-xs text-muted-foreground sm:grid">
          <span>{t('product')}</span>
          <span className="text-right">{t('quantity')}</span>
          <span className="text-right">{t('price')}</span>
          <span className="text-right">{t('discount')}</span>
          <span className="text-right">{t('sum')}</span>
          <span />
        </div>
        {lines.map((l, i) => {
          const qty = Number(parsePositive(l.quantity, 3)) || 0
          const stock = l.product ? Number(balances[l.product.id]?.[warehouseId] ?? 0) : null
          const short = l.product && qty > 0 && taken(l.product.id) > (stock ?? 0)
          const amount = lineAmount(l.quantity, l.price, l.discount)
          const remove = () => setLines(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : [blankLine()])
          const lineError = [...bad].find((b) => b.startsWith(`${l.key}-`))
          return (
            <div key={l.key} className="grid gap-y-2 border-b border-(--line) py-2 last:border-0 sm:border-0 sm:py-1">
              <div className="grid grid-cols-3 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_9rem_6rem_9rem_2.25rem] sm:gap-3">
                <div className="col-span-3 flex gap-2 sm:col-span-1">
                  <div className="min-w-0 flex-1">
                    <ProductPicker
                      id={`order-line-${l.key}`}
                      value={l.product}
                      invalid={bad.has(`${l.key}-product`)}
                      autoFocus={i === lines.length - 1 && i > 0}
                      onChange={(product) => {
                        const p = priceIn(product, listId)
                        setLine(l.key, { product, price: p ? formatAmount(p) : l.price })
                      }}
                    />
                  </div>
                  <Button type="button" size="icon" variant="ghost" className="sm:hidden" aria-label={`${t('removeLine')} ${i + 1}`} onClick={remove}>
                    <X aria-hidden="true" />
                  </Button>
                </div>
                <Input value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} inputMode="decimal" autoComplete="off" placeholder={t('quantity')} aria-label={`${t('quantity')} ${i + 1}`} aria-invalid={bad.has(`${l.key}-quantity`) || undefined} className="text-right tabular-nums" />
                <Input value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} inputMode="decimal" autoComplete="off" placeholder={t('price')} aria-label={`${t('price')} ${i + 1}`} aria-invalid={bad.has(`${l.key}-price`) || undefined} className="text-right tabular-nums" />
                <Input value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} inputMode="decimal" autoComplete="off" placeholder="0" aria-label={`${t('discount')} ${i + 1}`} aria-invalid={bad.has(`${l.key}-discount`) || undefined} className="text-right tabular-nums" />
                <span className="col-span-2 text-right text-sm tabular-nums sm:col-span-1">{amount > 0 && formatAmount(amount.toFixed(2))}</span>
                <Button type="button" size="icon" variant="ghost" className="hidden sm:inline-flex" aria-label={`${t('removeLine')} ${i + 1}`} onClick={remove}>
                  <X aria-hidden="true" />
                </Button>
              </div>
              {(short || (l.product && stock !== null)) && (
                <p className={`flex items-center gap-1.5 px-1 text-xs ${short ? 'text-red' : 'text-muted-foreground'}`}>
                  {short && <TriangleAlert className="size-3.5 flex-none" aria-hidden="true" />}
                  {short && `${t('notEnough')} · `}
                  {t('available')}: {formatDecimal(String(stock ?? 0))} {l.product && t(`unit_${l.product.unit}` as Key)}
                  {l.product && !l.price && l.product.prices?.length > 0 && !priceIn(l.product, listId) && ` · ${t('noPrice')}`}
                </p>
              )}
              {lineError && (
                <p className="flex items-center gap-1.5 px-1 text-xs text-red">
                  <AlertCircle className="size-3.5 flex-none" aria-hidden="true" />
                  {lineError.endsWith('product') ? t('chooseProduct') : lineError.endsWith('quantity') ? t('invalidQuantity') : t('invalidPrice')}
                </p>
              )}
            </div>
          )
        })}
        <div className="flex flex-wrap items-start justify-between gap-3 pt-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setLines([...lines, blankLine()])}>
            <Plus aria-hidden="true" /> {t('addLine')}
          </Button>
          <div className="grid justify-items-end text-sm">
            <span>
              {t('total')}: <strong className="tabular-nums">{formatAmount(total.toFixed(2))} {currencyLabel(currency, lang)}</strong>
            </span>
            {vat > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {t('vatIncluded')} ({formatDecimal(String(vat))}%): {formatAmount(vatTotal.toFixed(2))}
              </span>
            )}
          </div>
        </div>
        {bad.has('lines') && <p className="px-1 text-sm text-red">{t('noLines')}</p>}
      </section>

      {failed && (
        <p role="alert" className="mt-4 flex items-center gap-2 rounded-2xl bg-red/10 px-3.5 py-2.5 text-sm text-red">
          <AlertCircle className="size-4 flex-none" aria-hidden="true" />
          {t(failed)}
        </p>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="submit" variant="outline" disabled={busy}>{t('saveDraft')}</Button>
        <Button type="button" disabled={busy} onClick={() => submit(true)}>{t('confirmOrder')}</Button>
      </div>

      {order && (
        <CancelDialog
          open={confirmingCancel}
          onOpenChange={setConfirmingCancel}
          busy={cancel.isPending}
          onCancel={() => cancel.mutate(order.id, { onSuccess: () => (setConfirmingCancel(false), toast.success(t('orderCancelled'))) })}
        />
      )}
    </form>
  )
}

function CancelDialog({ open, onOpenChange, busy, onCancel }: { open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; onCancel: () => void }) {
  const { t } = usePrefs()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('cancelOrderQ')}</DialogTitle>
          <DialogDescription>{t('cancelOrderText')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('keepOrder')}</Button>
          <Button variant="destructive" disabled={busy} onClick={onCancel}>{t('cancelDoc')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function View({ order }: { order: Order }) {
  const { t, lang } = usePrefs()
  const can = useCan()
  const me = useMe().data
  const { cancel } = useOrderMutations()
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [returning, setReturning] = useState(false)
  // something is still left to bring back
  const returnable = order.status === 'confirmed' && order.lines.some((l) => Number(l.quantity) > Number(l.returned))
  const warehouse = useQuery(warehousesQuery).data?.find((w) => w.id === order.warehouse_id)
  const list = useQuery(priceListsQuery).data?.find((l) => l.id === order.price_list_id)
  const pay = payState(order, isoToday())
  const vatRate = order.lines.find((l) => Number(l.vat_rate))?.vat_rate
  const day = formatDay(localDate(order.date), lang)
  const money = (v: string) => formatMoney(v, order.currency, lang)

  const lineTable = (
    <table className="w-full table-fixed text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr className="border-b border-(--line)">
          <th scope="col" className="w-10 px-4 py-3 font-medium">#</th>
          <th scope="col" className="px-4 py-3 font-medium">{t('product')}</th>
          <th scope="col" className="w-24 px-4 py-3 text-right font-medium sm:w-32">{t('quantity')}</th>
          <th scope="col" className="hidden w-36 px-4 py-3 text-right font-medium sm:table-cell print:table-cell">{t('price')}</th>
          <th scope="col" className="hidden w-24 px-4 py-3 text-right font-medium md:table-cell print:table-cell">{t('discount')}</th>
          <th scope="col" className="w-28 px-4 py-3 text-right font-medium sm:w-40">{t('sum')}</th>
        </tr>
      </thead>
      <tbody>
        {order.lines.map((l, i) => (
          <tr key={l.id} className="border-b border-(--line) last:border-0">
            <td className="px-4 py-3 text-muted-foreground tabular-nums">{i + 1}</td>
            <td className="px-4 py-3">{l.product_name}</td>
            <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
              {formatDecimal(l.quantity)} <span className="text-xs text-muted-foreground">{t(`unit_${l.unit}` as Key)}</span>
              {Number(l.returned) > 0 && (
                <span className="block text-xs text-muted-foreground print:hidden">
                  {t('returnedAlready')}: {formatDecimal(l.returned)}
                </span>
              )}
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
        {t('total')}: <strong className="tabular-nums">{money(order.total)}</strong>
      </span>
      {Number(order.vat_total) > 0 && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {t('vatIncluded')} ({formatDecimal(vatRate ?? '0')}%): {formatAmount(order.vat_total)}
        </span>
      )}
      {Number(order.returned_total) > 0 && (
        <span className="text-sm tabular-nums print:hidden">
          {t('returnedSum')}: {money(order.returned_total)}
        </span>
      )}
      {order.exchange_rate && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {t('exchangeRate')}: 1 {order.currency} = {formatDecimal(order.exchange_rate)} {currencyLabel('UZS', lang)} · ≈ {formatMoney((Number(order.total) * Number(order.exchange_rate)).toFixed(2), 'UZS', lang)}
        </span>
      )}
    </div>
  )

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`${t('order')} № ${order.number}`}
          description={<Badge variant={order.status === 'confirmed' ? 'default' : 'secondary'}>{t(STATUS_LABEL[order.status])}</Badge>}
          actions={
            <>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer aria-hidden="true" /> {t('print')}
              </Button>
              {returnable && can('orders.write') && (
                <Button variant="outline" onClick={() => setReturning(true)}>
                  <Undo2 aria-hidden="true" /> {t('returnGoods')}
                </Button>
              )}
              {order.status === 'confirmed' && can('orders.write') && (
                <Button variant="ghost" onClick={() => setConfirmingCancel(true)}>
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
                <Link key="c" to="/customers/$customerId" params={{ customerId: String(order.customer_id) }} className="font-medium hover:underline">
                  {order.customer_name}
                </Link>,
              ],
              [t('date'), day],
              ...(pay
                ? [
                    [
                      t('paymentState'),
                      <span key="p" className="flex flex-wrap items-center gap-2">
                        <PayBadge state={pay} />
                        {pay !== 'paid' && order.unpaid && <span className="tabular-nums">{formatMoney(order.unpaid, order.currency, lang)}</span>}
                      </span>,
                    ],
                  ]
                : []),
              ...(order.status === 'confirmed' && order.due_date ? [[t('dueDate'), formatDay(localDate(order.due_date), lang)]] : []),
              [t('warehouse'), warehouse?.name ?? ''],
              [t('priceList'), list ? `${list.name} · ${currencyLabel(list.currency, lang)}` : ''],
              ...(order.note ? [[t('note'), order.note]] : []),
            ] as [string, ReactNode][]).map(([label, value]) => (
              <div key={label} className="grid gap-0.5">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="break-words">{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className={`glass rise overflow-hidden ${order.status === 'cancelled' ? 'opacity-70' : ''}`} style={{ '--i': 2 } as CSSProperties} aria-label={t('linesCount')}>
          {lineTable}
          {totals}
        </section>
        {order.returns.length > 0 && (
          <section className="glass rise mt-4 p-5" style={{ '--i': 3 } as CSSProperties}>
            <h2 className="mb-2 text-lg font-semibold">{t('returnsTitle')}</h2>
            <ul className="grid gap-1.5 text-sm">
              {order.returns.map((r) => (
                <li key={r.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${r.cancelled ? 'opacity-60' : ''}`}>
                  <Link to="/returns/$returnId" params={{ returnId: String(r.id) }} className="font-medium hover:underline">
                    {t('returnDoc')} № {r.number}
                  </Link>
                  <span className="text-muted-foreground">{formatDay(localDate(r.date), lang)}</span>
                  <span className="tabular-nums">{money(r.total)}</span>
                  {r.cancelled && <Badge variant="secondary">{t('cancelledBadge')}</Badge>}
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className={`mt-4 grid items-start gap-4 ${can('tasks') ? 'lg:grid-cols-2' : ''}`}>
          {can('tasks') && <CustomerTasks customer={{ id: order.customer_id, name: order.customer_name }} order={{ id: order.id, number: order.number }} />}
          <section className="glass rise p-5" style={{ '--i': 5 } as CSSProperties}>
            <Timeline scope={{ entity: 'order', entityId: order.id }} title={t('history')} />
          </section>
        </div>
      </div>

      {/* the printed invoice (yuk xati): plain black on white, only on paper */}
      <article className="invoice hidden print:block">
        <h1 className="mb-1 text-xl font-semibold">
          {t('invoice')} № {order.number}
        </h1>
        <p className="mb-4 text-sm">{day}</p>
        <dl className="mb-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs">{t('supplier')}</dt>
            <dd className="font-medium">{me?.company_name}</dd>
          </div>
          <div>
            <dt className="text-xs">{t('buyer')}</dt>
            <dd className="font-medium">{order.customer_name}</dd>
          </div>
        </dl>
        {lineTable}
        {totals}
        <div className="mt-12 grid grid-cols-2 gap-8 text-sm">
          <p className="border-t border-current pt-1">{t('handedOver')}</p>
          <p className="border-t border-current pt-1">{t('receivedBy')}</p>
        </div>
      </article>

      <CancelDialog
        open={confirmingCancel}
        onOpenChange={setConfirmingCancel}
        busy={cancel.isPending}
        onCancel={() =>
          cancel.mutate(order.id, {
            onSuccess: () => (setConfirmingCancel(false), toast.success(t('orderCancelled'))),
            // its returns still count: they'd bring the goods back a second time
            onError: (err) => (setConfirmingCancel(false), toast.error(t(invalidFields(err).has('status') ? 'cancelReturnsFirst' : 'notSaved'))),
          })
        }
      />
      {returnable && <ReturnDialog order={order} open={returning} onOpenChange={setReturning} />}
    </>
  )
}
