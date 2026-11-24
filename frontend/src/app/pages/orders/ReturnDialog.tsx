// Goods coming back from a confirmed order: how much of each line (never more than was sold less
// earlier returns), into which warehouse and on which day. Saved as a posted return: the stock goes
// up and the customer owes that much less, at the order's own prices.
import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { invalidFields } from '../../api'
import { isoToday } from '../../dates'
import type { Key } from '../../i18n'
import { formatDecimal, formatMoney, parsePositive } from '../../money'
import { useOrderMutations, type Order } from '../../orders'
import { usePrefs } from '../../prefs'
import { warehousesQuery } from '../../stock'

// quantities in thousandths, so 0.1 + 0.2 compares as people expect
const milli = (v: string) => Math.round(Number(v) * 1000)

export default function ReturnDialog({ order, open, onOpenChange }: { order: Order; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = usePrefs()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('returnTitle')}</DialogTitle>
          <DialogDescription>{t('returnText')}</DialogDescription>
        </DialogHeader>
        {/* mounted only while open, so it starts empty every time */}
        <Body order={order} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ order, close }: { order: Order; close: () => void }) {
  const { t, lang } = usePrefs()
  const navigate = useNavigate()
  const { addReturn } = useOrderMutations()
  const warehouses = (useQuery(warehousesQuery).data ?? []).filter((w) => !w.archived)
  // back where they were sold from, unless that warehouse has been archived since
  const [picked, setPicked] = useState<number | null>(null)
  const warehouse = picked ?? (warehouses.some((w) => w.id === order.warehouse_id) ? order.warehouse_id : (warehouses.find((w) => w.is_default) ?? warehouses[0])?.id)
  const [date, setDate] = useState(() => (isoToday() < order.date ? order.date : isoToday()))
  const [note, setNote] = useState('')
  const [qty, setQty] = useState<Record<number, string>>({})
  const [bad, setBad] = useState<'lines' | 'none' | 'date' | 'failed' | null>(null)

  // what's left to bring back of each line
  const left = Object.fromEntries(order.lines.map((l) => [l.id, (milli(l.quantity) - milli(l.returned)) / 1000]))
  const typed = order.lines.map((l) => ({ line: l, raw: qty[l.id]?.trim() ?? '' })).filter((x) => x.raw)
  const parsed = typed.map(({ line, raw }) => ({ line, q: parsePositive(raw, 3) }))
  const wrong = new Set(parsed.filter(({ line, q }) => !q || milli(q) > milli(String(left[line.id]))).map(({ line }) => line.id))
  // an estimate for the form; the server computes it to the cent from the order's own amounts
  const estimate = parsed.reduce((s, { line, q }) => s + (q && !wrong.has(line.id) ? (Number(q) * Number(line.amount)) / Number(line.quantity) : 0), 0)

  function all() {
    setQty(Object.fromEntries(order.lines.filter((l) => left[l.id] > 0).map((l) => [l.id, String(left[l.id])])))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (wrong.size) return setBad('lines')
    if (!parsed.length) return setBad('none')
    if (date < order.date) return setBad('date')
    if (warehouse === undefined) return setBad('failed')
    setBad(null)
    addReturn.mutate(
      { orderId: order.id, date, warehouse_id: warehouse, note, lines: parsed.map(({ line, q }) => ({ order_line_id: line.id, quantity: q! })) },
      {
        onSuccess: (r) => {
          toast.success(`${t('returnSaved')} № ${r.number}`)
          close()
          navigate({ to: '/returns/$returnId', params: { returnId: String(r.id) } })
        },
        onError: (err) => {
          const fields = invalidFields(err)
          setBad(fields.has('lines') ? 'lines' : fields.has('date') ? 'date' : 'failed')
        },
      },
    )
  }

  const message: Partial<Record<NonNullable<typeof bad>, Key>> = { lines: 'returnTooMuch', none: 'returnNothing', date: 'returnBeforeOrder', failed: 'notSaved' }
  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="max-h-[45vh] overflow-y-auto rounded-2xl border border-(--line)">
        <table className="w-full table-fixed text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-(--line)">
              <th scope="col" className="px-3 py-2 font-medium">{t('product')}</th>
              <th scope="col" className="hidden w-28 px-3 py-2 text-right font-medium sm:table-cell">{t('returnSold')}</th>
              <th scope="col" className="w-32 px-3 py-2 text-right font-medium">{t('returnQty')}</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => {
              const unit = t(`unit_${l.unit}` as Key)
              return (
                <tr key={l.id} className="border-b border-(--line) last:border-0">
                  <td className="px-3 py-2">
                    <span className="block truncate">{l.product_name}</span>
                    {Number(l.returned) > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {t('returnedAlready')}: {formatDecimal(l.returned)} {unit}
                      </span>
                    )}
                  </td>
                  <td className="hidden px-3 py-2 text-right whitespace-nowrap tabular-nums sm:table-cell">
                    {formatDecimal(l.quantity)} <span className="text-xs text-muted-foreground">{unit}</span>
                  </td>
                  <td className="px-3 py-2">
                    {left[l.id] > 0 ? (
                      <Input
                        value={qty[l.id] ?? ''}
                        onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                        inputMode="decimal"
                        className="text-right"
                        placeholder={formatDecimal(String(left[l.id]))}
                        aria-label={`${t('returnQty')}: ${l.product_name}`}
                        aria-invalid={wrong.has(l.id) || undefined}
                      />
                    ) : (
                      <span className="block text-right text-xs text-muted-foreground">{t('returnedAll')}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <Button type="button" variant="secondary" size="sm" onClick={all}>{t('returnAll')}</Button>
        <span>
          {t('total')}: <strong className="tabular-nums">≈ {formatMoney(estimate.toFixed(2), order.currency, lang)}</strong>
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <Label htmlFor="ret-warehouse">{t('warehouse')}</Label>
          <Select value={warehouse === undefined ? undefined : String(warehouse)} onValueChange={(v) => setPicked(Number(v))}>
            <SelectTrigger id="ret-warehouse">
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
          <Label htmlFor="ret-date">{t('date')}</Label>
          <Input id="ret-date" type="date" value={date} min={order.date} max="9999-12-31" onChange={(e) => setDate(e.target.value || isoToday())} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ret-note">{t('note')}</Label>
        <Textarea id="ret-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} />
      </div>
      {bad && message[bad] && (
        <p role="alert" className="flex items-center gap-2 rounded-2xl bg-red/10 px-3.5 py-2.5 text-sm text-red">
          <AlertCircle className="size-4 flex-none" aria-hidden="true" />
          {t(message[bad]!)}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close}>{t('cancel')}</Button>
        <Button type="submit" disabled={addReturn.isPending}>{t('returnSave')}</Button>
      </DialogFooter>
    </form>
  )
}
