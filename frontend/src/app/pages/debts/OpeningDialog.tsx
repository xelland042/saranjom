// What a customer already owed (or had paid ahead) when the company started with Saranjom: typed
// in once from the old records (1C, Excel, a notebook), one sum per currency.
import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { isoToday } from '../../dates'
import { useDebtMutations, type Balance } from '../../debts'
import Field from '../../Field'
import { currencyLabel, formatAmount, parseAmount } from '../../money'
import { usePrefs } from '../../prefs'
import { priceListsQuery } from '../../products'

type Props = { open: boolean; onOpenChange: (open: boolean) => void; customerId: number; balances: Balance[]; currency: string }

export default function OpeningDialog({ open, onOpenChange, ...rest }: Props) {
  const { t } = usePrefs()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('openingDebt')}</DialogTitle>
          <DialogDescription>{t('openingIntro')}</DialogDescription>
        </DialogHeader>
        <Body {...rest} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ customerId, balances, currency: first, close }: Omit<Props, 'open' | 'onOpenChange'> & { close: () => void }) {
  const { t, lang } = usePrefs()
  const { setOpening, deleteOpening } = useDebtMutations()
  const lists = useQuery(priceListsQuery).data ?? []
  const [currency, setCurrency] = useState(first)
  const saved = balances.find((b) => b.currency === currency)?.opening
  const [ahead, setAhead] = useState(saved ? Number(saved.amount) < 0 : false)
  const [amount, setAmount] = useState(saved ? formatAmount(saved.amount.replace('-', '')) : '')
  const [date, setDate] = useState(saved?.date ?? isoToday())
  const [bad, setBad] = useState(false)
  const currencies = [...new Set([first, ...balances.map((b) => b.currency), ...lists.filter((l) => !l.archived).map((l) => l.currency)])]

  function pick(c: string) {
    const o = balances.find((b) => b.currency === c)?.opening
    setCurrency(c)
    setAhead(o ? Number(o.amount) < 0 : false)
    setAmount(o ? formatAmount(o.amount.replace('-', '')) : '')
    setDate(o?.date ?? isoToday())
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const sum = parseAmount(amount)
    if (!sum || Number(sum) <= 0) return setBad(true)
    setOpening.mutate(
      { customerId, currency, amount: ahead ? `-${sum}` : sum, date },
      { onSuccess: () => (toast.success(t('saved')), close()), onError: () => toast.error(t('notSaved')) },
    )
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Tabs value={ahead ? 'ahead' : 'owes'} onValueChange={(v) => setAhead(v === 'ahead')}>
        <TabsList className="w-full">
          <TabsTrigger value="owes" className="flex-1">{t('theyOwe')}</TabsTrigger>
          <TabsTrigger value="ahead" className="flex-1">{t('paidAhead')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid gap-1.5">
        <Label htmlFor="opening-amount">{t('amount')}</Label>
        <div className="flex gap-2">
          <Input
            id="opening-amount"
            value={amount}
            onChange={(e) => (setAmount(e.target.value), setBad(false))}
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            className="min-w-0 flex-1 text-right tabular-nums"
            aria-invalid={bad || undefined}
            aria-describedby={bad ? 'opening-error' : undefined}
          />
          <Select value={currency} onValueChange={pick}>
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
        {bad && <p id="opening-error" className="text-xs text-red">{t('invalidAmount')}</p>}
      </div>
      <Field id="opening-date" label={t('openingDate')} hint={t('openingDateHint')}>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value || isoToday())} max="9999-12-31" />
      </Field>
      <DialogFooter>
        {saved && (
          <Button
            type="button"
            variant="ghost"
            className="sm:mr-auto"
            disabled={deleteOpening.isPending}
            onClick={() => deleteOpening.mutate({ customerId, currency }, { onSuccess: () => (toast.success(t('saved')), close()) })}
          >
            <Trash2 aria-hidden="true" /> {t('delete')}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={close}>{t('cancel')}</Button>
        <Button type="submit" disabled={setOpening.isPending}>{t('save')}</Button>
      </DialogFooter>
    </form>
  )
}
