// Receive money from a customer. From a customer's page the customer is fixed; from the payments
// list it's picked. The currency starts at the customer's price list's; the debt in that currency
// goes down.
import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { invalidFields } from '../../api'
import { searchCustomers, type CustomerRow } from '../../customers'
import { isoToday } from '../../dates'
import { customerBalancesQuery, METHOD_LABEL, METHODS, useDebtMutations, type Method } from '../../debts'
import Field from '../../Field'
import { currencyLabel, formatAmount, formatMoney, parseAmount } from '../../money'
import Picker from '../../Picker'
import { usePrefs } from '../../prefs'
import { priceListsQuery } from '../../products'

type Customer = Pick<CustomerRow, 'id' | 'name' | 'price_list_id'>
type Props = { open: boolean; onOpenChange: (open: boolean) => void; customer?: Customer; currency?: string }

export default function PaymentDialog({ open, onOpenChange, customer, currency }: Props) {
  const { t } = usePrefs()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('receivePayment')}</DialogTitle>
          <DialogDescription>{customer ? customer.name : t('paymentIntro')}</DialogDescription>
        </DialogHeader>
        {/* mounted only while open, so every opening starts blank */}
        <Body fixed={customer} currency={currency} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ fixed, currency: given, close }: { fixed?: Customer; currency?: string; close: () => void }) {
  const { t, lang } = usePrefs()
  const { pay } = useDebtMutations()
  const [customer, setCustomer] = useState<Customer | null>(fixed ?? null)
  const [amount, setAmount] = useState('')
  const [chosen, setChosen] = useState(given ?? '')
  const [method, setMethod] = useState<Method>('cash')
  const [date, setDate] = useState(isoToday)
  const [note, setNote] = useState('')
  const [bad, setBad] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState<'notSaved' | 'noRateForCurrency' | null>(null)

  const lists = useQuery(priceListsQuery).data ?? []
  const balances = useQuery({ ...customerBalancesQuery(customer?.id ?? 0), enabled: !!customer }).data ?? []
  const own = lists.find((l) => (customer?.price_list_id ? l.id === customer.price_list_id : l.is_default))
  // the currencies they owe in come first; then those the company prices in
  const currencies = [...new Set([...balances.filter((b) => Number(b.balance) > 0).map((b) => b.currency), own?.currency, ...lists.filter((l) => !l.archived).map((l) => l.currency)])].filter(
    (c): c is string => !!c,
  )
  const currency = chosen || currencies[0] || 'UZS'
  const owed = balances.find((b) => b.currency === currency)

  function submit(e: FormEvent) {
    e.preventDefault()
    const errors = new Set<string>()
    const sum = parseAmount(amount)
    if (!customer) errors.add('customer')
    if (!sum || Number(sum) <= 0) errors.add('amount')
    setBad(errors)
    if (errors.size) return
    setFailed(null)
    pay.mutate(
      { customer_id: customer!.id, amount: sum!, currency, method, date, note },
      {
        onSuccess: () => (toast.success(t('paymentSaved')), close()),
        onError: (err) => setFailed(invalidFields(err).has('exchange_rate') ? 'noRateForCurrency' : 'notSaved'),
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      {!fixed && (
        <div className="grid gap-1.5">
          <Label htmlFor="payment-customer">{t('customer')}</Label>
          <Picker
            id="payment-customer"
            value={customer}
            onChange={(c) => (setCustomer(c), setChosen(''), setBad(new Set()))}
            search={searchCustomers}
            queryKey="customers"
            label={(c) => c.name}
            placeholder={t('chooseCustomer')}
            noMatches={t('noMatches')}
            invalid={bad.has('customer')}
            autoFocus
          />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="payment-amount">{t('amount')}</Label>
        <div className="flex gap-2">
          <Input
            id="payment-amount"
            value={amount}
            onChange={(e) => (setAmount(e.target.value), setBad(new Set()))}
            inputMode="decimal"
            autoComplete="off"
            autoFocus={!!fixed}
            className="min-w-0 flex-1 text-right text-lg tabular-nums"
            aria-invalid={bad.has('amount') || undefined}
            aria-describedby="payment-owed"
          />
          <Select value={currency} onValueChange={setChosen}>
            <SelectTrigger className="w-24" aria-label={t('currency')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(currencies.length ? currencies : ['UZS']).map((c) => (
                <SelectItem key={c} value={c}>{currencyLabel(c, lang)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p id="payment-owed" className={`text-xs ${bad.has('amount') ? 'text-red' : 'text-muted-foreground'}`}>
          {bad.has('amount') ? (
            t('invalidAmount')
          ) : owed && Number(owed.balance) > 0 ? (
            <>
              {t('owes')}:{' '}
              <button type="button" className="font-medium text-(--text) tabular-nums underline-offset-4 hover:underline" onClick={() => setAmount(formatAmount(owed.balance))}>
                {formatMoney(owed.balance, currency, lang)}
              </button>
            </>
          ) : (
            customer && t('owesNothing')
          )}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="payment-method">{t('paymentMethod')}</Label>
          <Select value={method} onValueChange={(v) => setMethod(v as Method)}>
            <SelectTrigger id="payment-method" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m}>{t(METHOD_LABEL[m])}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Field id="payment-date" label={t('date')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value || isoToday())} max="9999-12-31" />
        </Field>
      </div>
      <Field id="payment-note" label={t('note')} optional={t('optional')}>
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
        <Button type="submit" disabled={pay.isPending}>{t('receive')}</Button>
      </DialogFooter>
    </form>
  )
}
