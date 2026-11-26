// Money in or out that is nobody's payment: an expense, other money in (the amount the company
// started with, the owner's own money), or a transfer between the cash box and the bank, which is
// also how currency is exchanged.
import { useState, type FormEvent } from 'react'
import { AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { invalidFields } from '../../api'
import { CATEGORY_LABEL, EXPENSES, INCOMES, PLACE_LABEL, PLACES, useMoneyMutations, type Category, type MoveKind, type Place } from '../../cash'
import { isoToday } from '../../dates'
import Field from '../../Field'
import type { Key } from '../../i18n'
import { CURRENCIES, currencyLabel, parseAmount } from '../../money'
import { usePrefs } from '../../prefs'

export type MoveStart = { kind: MoveKind; category?: Category }
type Props = { open: boolean; onOpenChange: (open: boolean) => void; start: MoveStart }

const TEXT: Record<MoveKind, { title: Key; intro: Key }> = {
  expense: { title: 'expenseTitle', intro: 'expenseIntro' },
  income: { title: 'incomeTitle', intro: 'incomeIntro' },
  transfer: { title: 'transferTitle', intro: 'moneyTransferIntro' },
}

export default function MoveDialog({ open, onOpenChange, start }: Props) {
  const { t } = usePrefs()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(TEXT[start.kind].title)}</DialogTitle>
          <DialogDescription>{t(TEXT[start.kind].intro)}</DialogDescription>
        </DialogHeader>
        {/* mounted only while open, so every opening starts blank */}
        <Body start={start} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ start, close }: { start: MoveStart; close: () => void }) {
  const { t, lang } = usePrefs()
  const { add } = useMoneyMutations()
  const { kind } = start
  const categories: readonly Category[] = kind === 'expense' ? EXPENSES : INCOMES
  const [category, setCategory] = useState<Category>(start.category ?? categories[0])
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(CURRENCIES[0])
  const [place, setPlace] = useState<Place>('cash')
  const [toPlace, setToPlace] = useState<Place>('bank')
  const [toCurrency, setToCurrency] = useState(CURRENCIES[0])
  const [received, setReceived] = useState('')
  const [date, setDate] = useState(isoToday)
  const [note, setNote] = useState('')
  const [bad, setBad] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState<'notSaved' | 'noRateForCurrency' | 'samePlace' | null>(null)
  const exchange = kind === 'transfer' && toCurrency !== currency

  function submit(e: FormEvent) {
    e.preventDefault()
    const sum = parseAmount(amount)
    const arrived = exchange ? parseAmount(received) : undefined
    const wrong = new Set<string>()
    if (!sum || Number(sum) <= 0) wrong.add('amount')
    if (exchange && (!arrived || Number(arrived) <= 0)) wrong.add('received')
    setBad(wrong)
    if (wrong.size) return
    if (kind === 'transfer' && !exchange && toPlace === place) return setFailed('samePlace')
    setFailed(null)
    add.mutate(
      {
        kind,
        place,
        currency,
        amount: sum!,
        date,
        note,
        ...(kind === 'transfer' ? { to_place: toPlace, to_currency: toCurrency, received: arrived ?? undefined } : { category }),
      },
      {
        onSuccess: () => (toast.success(t('saved')), close()),
        onError: (err) => setFailed(invalidFields(err).has('exchange_rate') ? 'noRateForCurrency' : 'notSaved'),
      },
    )
  }

  const placeSelect = (id: string, label: Key, value: Place, onChange: (p: Place) => void) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{t(label)}</Label>
      <Select value={value} onValueChange={(v) => (onChange(v as Place), setFailed(null))}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PLACES.map((p) => (
            <SelectItem key={p} value={p}>{t(PLACE_LABEL[p])}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
  const currencySelect = (label: Key, value: string, onChange: (c: string) => void) => (
    <Select value={value} onValueChange={(v) => (onChange(v), setFailed(null))}>
      <SelectTrigger className="w-24" aria-label={t(label)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CURRENCIES.map((c) => (
          <SelectItem key={c} value={c}>{currencyLabel(c, lang)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      {kind !== 'transfer' && (
        <div className="grid gap-1.5">
          <Label htmlFor="move-category">{t(kind === 'expense' ? 'expenseKind' : 'incomeKind')}</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
            <SelectTrigger id="move-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{t(CATEGORY_LABEL[c])}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="move-amount">{t('amount')}</Label>
        <div className="flex gap-2">
          <Input
            id="move-amount"
            value={amount}
            onChange={(e) => (setAmount(e.target.value), setBad(new Set()))}
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            className="min-w-0 flex-1 text-right text-lg tabular-nums"
            aria-invalid={bad.has('amount') || undefined}
            aria-describedby={bad.has('amount') ? 'move-amount-error' : undefined}
          />
          {currencySelect('currency', currency, (c) => (setCurrency(c), kind === 'transfer' && toCurrency === currency && setToCurrency(c)))}
        </div>
        {bad.has('amount') && <p id="move-amount-error" className="text-xs text-red">{t('invalidAmount')}</p>}
      </div>
      {kind === 'transfer' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {placeSelect('move-place', 'fromPlace', place, setPlace)}
            {placeSelect('move-to-place', 'toPlace', toPlace, setToPlace)}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="move-received">{t(exchange ? 'receivedAmount' : 'toCurrency')}</Label>
            <div className="flex gap-2">
              {/* the same currency arrives as it left; an exchange asks what arrived */}
              <Input
                id="move-received"
                value={exchange ? received : amount}
                onChange={(e) => (setReceived(e.target.value), setBad(new Set()))}
                disabled={!exchange}
                inputMode="decimal"
                autoComplete="off"
                className="min-w-0 flex-1 text-right tabular-nums"
                aria-invalid={bad.has('received') || undefined}
                aria-describedby={bad.has('received') ? 'move-received-error' : undefined}
              />
              {currencySelect('toCurrency', toCurrency, setToCurrency)}
            </div>
            {bad.has('received') && <p id="move-received-error" className="text-xs text-red">{t('invalidAmount')}</p>}
          </div>
        </>
      ) : (
        placeSelect('move-place', kind === 'expense' ? 'fromPlace' : 'toPlace', place, setPlace)
      )}
      <Field id="move-date" label={t('date')}>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value || isoToday())} max="9999-12-31" />
      </Field>
      <Field id="move-note" label={t('note')} optional={t('optional')}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} />
      </Field>
      {failed && (
        <p role="alert" className="flex items-center gap-2 rounded-2xl bg-red/10 px-3.5 py-2.5 text-sm text-red">
          <AlertCircle className="size-4 flex-none" aria-hidden="true" />
          {t(failed)}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close}>{t('cancel')}</Button>
        <Button type="submit" disabled={add.isPending}>{t('save')}</Button>
      </DialogFooter>
    </form>
  )
}
