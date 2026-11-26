// Pay a supplier, from their page. What we owe them in the chosen currency goes down; the
// currencies we owe in come first.
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
import { isoToday } from '../../dates'
import { METHOD_LABEL, METHODS, type Method } from '../../debts'
import Field from '../../Field'
import { CURRENCIES, currencyLabel, formatAmount, formatMoney, parseAmount } from '../../money'
import { usePrefs } from '../../prefs'
import { useSupplierMutations, type Supplier } from '../../suppliers'

type Props = { open: boolean; onOpenChange: (open: boolean) => void; supplier: Supplier }

export default function SupplierPayDialog({ open, onOpenChange, supplier }: Props) {
  const { t } = usePrefs()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('paySupplierTitle')}</DialogTitle>
          <DialogDescription>{supplier.name}</DialogDescription>
        </DialogHeader>
        {/* mounted only while open, so every opening starts blank */}
        <Body supplier={supplier} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ supplier, close }: { supplier: Supplier; close: () => void }) {
  const { t, lang } = usePrefs()
  const { pay } = useSupplierMutations()
  const debts = supplier.balances.filter((b) => Number(b.owed) > 0)
  const currencies = [...new Set([...debts.map((b) => b.currency), ...CURRENCIES])]
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(currencies[0])
  const [method, setMethod] = useState<Method>('cash')
  const [date, setDate] = useState(isoToday)
  const [note, setNote] = useState('')
  const [bad, setBad] = useState(false)
  const [failed, setFailed] = useState<'notSaved' | 'noRateForCurrency' | null>(null)
  const owed = debts.find((b) => b.currency === currency)

  function submit(e: FormEvent) {
    e.preventDefault()
    const sum = parseAmount(amount)
    if (!sum || Number(sum) <= 0) return setBad(true)
    setFailed(null)
    pay.mutate(
      { supplier_id: supplier.id, amount: sum, currency, method, date, note },
      {
        onSuccess: () => (toast.success(t('paymentSaved')), close()),
        onError: (err) => setFailed(invalidFields(err).has('exchange_rate') ? 'noRateForCurrency' : 'notSaved'),
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="payout-amount">{t('amount')}</Label>
        <div className="flex gap-2">
          <Input
            id="payout-amount"
            value={amount}
            onChange={(e) => (setAmount(e.target.value), setBad(false))}
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            className="min-w-0 flex-1 text-right text-lg tabular-nums"
            aria-invalid={bad || undefined}
            aria-describedby="payout-owed"
          />
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="w-24" aria-label={t('currency')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currencies.map((c) => (
                <SelectItem key={c} value={c}>{currencyLabel(c, lang)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p id="payout-owed" className={`text-xs ${bad ? 'text-red' : 'text-muted-foreground'}`}>
          {bad ? (
            t('invalidAmount')
          ) : owed ? (
            <>
              {t('weOwe')}:{' '}
              <button type="button" className="font-medium text-(--text) tabular-nums underline-offset-4 hover:underline" onClick={() => setAmount(formatAmount(owed.owed))}>
                {formatMoney(owed.owed, currency, lang)}
              </button>
            </>
          ) : (
            t('weOweNothing')
          )}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="payout-method">{t('paymentMethod')}</Label>
          <Select value={method} onValueChange={(v) => setMethod(v as Method)}>
            <SelectTrigger id="payout-method" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m}>{t(METHOD_LABEL[m])}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Field id="payout-date" label={t('date')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value || isoToday())} max="9999-12-31" />
        </Field>
      </div>
      <Field id="payout-note" label={t('note')} optional={t('optional')}>
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
        <Button type="submit" disabled={pay.isPending}>{t('paySupplier')}</Button>
      </DialogFooter>
    </form>
  )
}
