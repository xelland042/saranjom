// Add or edit a customer in a dialog. While the name is typed it looks for similar customers,
// so the same firm isn't added twice under a slightly different spelling.
import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { AlertCircle, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, invalidFields } from '../../api'
import { similarCustomers, useCustomerMutations, type Customer, type CustomerFields } from '../../customers'
import Field from '../../Field'
import { currencyLabel, formatAmount, parseAmount } from '../../money'
import { usePrefs } from '../../prefs'
import { priceListsQuery } from '../../products'
import { useDebounced } from '../../useDebounced'

type Props = { open: boolean; onOpenChange: (open: boolean) => void; customer?: Customer }

export default function CustomerForm({ open, onOpenChange, customer }: Props) {
  const { t } = usePrefs()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(customer ? 'editCustomer' : 'newCustomer')}</DialogTitle>
          <DialogDescription className="sr-only">{t('customersIntro')}</DialogDescription>
        </DialogHeader>
        {/* mounted only while open, so every opening starts from the saved values */}
        <Body customer={customer} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

const blank = (c?: Customer): CustomerFields => ({
  name: c?.name ?? '',
  inn: c?.inn ?? '',
  phone: c?.phone ?? '',
  address: c?.address ?? '',
  note: c?.note ?? '',
  price_list_id: c?.price_list_id ?? null,
  payment_days: c?.payment_days ?? null,
  credit_limit: c?.credit_limit ?? null,
  credit_currency: c?.credit_currency ?? null,
})

function Body({ customer, close }: { customer?: Customer; close: () => void }) {
  const { t, lang } = usePrefs()
  const navigate = useNavigate()
  const { create, update } = useCustomerMutations()
  const [f, setF] = useState(() => blank(customer))
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const [duplicateOf, setDuplicateOf] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  // typed as text; turned into the API's values on save
  const [days, setDays] = useState(customer?.payment_days != null ? String(customer.payment_days) : '')
  const [limit, setLimit] = useState(customer?.credit_limit ? formatAmount(customer.credit_limit) : '')
  const [limitCurrency, setLimitCurrency] = useState(customer?.credit_currency ?? '')
  const lists = useQuery(priceListsQuery)
  const currencies = [...new Set([...(lists.data ?? []).filter((l) => !l.archived).map((l) => l.currency), ...(limitCurrency ? [limitCurrency] : [])])]
  const ownList = lists.data?.find((l) => (f.price_list_id ? l.id === f.price_list_id : l.is_default))
  const busy = create.isPending || update.isPending

  const name = useDebounced(f.name.trim(), 400)
  const similar = useQuery({
    ...similarCustomers(name, customer?.id),
    // when editing, only warn once the name actually changes
    enabled: name.length >= 3 && name !== customer?.name,
  })

  const set = (k: 'name' | 'inn' | 'phone' | 'address' | 'note') => (e: { target: { value: string } }) => {
    setF({ ...f, [k]: e.target.value })
    if (invalid.has(k)) setInvalid(new Set([...invalid].filter((x) => x !== k)))
    if (k === 'inn') setDuplicateOf(null)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.name.trim()) return setInvalid(new Set(['name']))
    const paymentDays = days.trim() ? Number(days.trim()) : null
    const creditLimit = parseAmount(limit)
    const bad = new Set<string>()
    if (paymentDays !== null && !(Number.isInteger(paymentDays) && paymentDays >= 0 && paymentDays <= 365)) bad.add('payment_days')
    if (creditLimit === undefined) bad.add('credit_limit')
    if (bad.size) return setInvalid(bad)
    const terms = {
      payment_days: paymentDays,
      credit_limit: creditLimit ?? null,
      credit_currency: creditLimit === null ? null : limitCurrency || ownList?.currency || 'UZS',
    }
    setFailed(false)
    const onError = (err: unknown) => {
      if (err instanceof ApiError && err.status === 409 && typeof err.body?.id === 'number') setDuplicateOf(err.body.id)
      else if (err instanceof ApiError && err.status === 422) setInvalid(invalidFields(err))
      else setFailed(true)
    }
    const onSuccess = (c: Customer) => {
      toast.success(t('saved'))
      close()
      if (!customer) navigate({ to: '/customers/$customerId', params: { customerId: String(c.id) } })
    }
    if (customer) update.mutate({ id: customer.id, ...f, ...terms }, { onSuccess, onError })
    else create.mutate({ ...f, ...terms }, { onSuccess, onError })
  }

  const matches = similar.data ?? []
  const openLink = (id: number) => (
    <Link to="/customers/$customerId" params={{ customerId: String(id) }} onClick={close} className="font-medium text-primary underline-offset-4 hover:underline">
      {t('openIt')}
    </Link>
  )

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field id="customer-name" label={t('customerName')} error={invalid.has('name') && t('invalidName')}>
        <Input value={f.name} onChange={set('name')} maxLength={200} autoComplete="off" autoFocus />
      </Field>

      {matches.length > 0 && (
        <div role="status" className="grid gap-2 rounded-2xl bg-(--soft) px-3.5 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert className="size-4 flex-none text-amber" aria-hidden="true" />
            {t('similarFound')}
          </p>
          <ul className="grid gap-1">
            {matches.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">
                  {m.name}
                  {m.inn && <span className="text-muted-foreground"> · {m.inn}</span>}
                  {m.archived && <span className="text-muted-foreground"> · {t('archived')}</span>}
                </span>
                {openLink(m.id)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="customer-inn" label={t('inn')} optional={t('optional')} hint={t('innHint')} error={invalid.has('inn') && t('invalidInn')}>
          <Input value={f.inn} onChange={set('inn')} inputMode="numeric" maxLength={20} autoComplete="off" />
        </Field>
        <Field id="customer-phone" label={t('phone')} optional={t('optional')} error={invalid.has('phone') && t('invalidPhone')}>
          <Input value={f.phone} onChange={set('phone')} type="tel" placeholder="+998 90 123 45 67" maxLength={30} autoComplete="off" />
        </Field>
      </div>

      {duplicateOf && (
        <p role="alert" className="flex items-center gap-2 rounded-2xl bg-red/10 px-3.5 py-2.5 text-sm text-red">
          <AlertCircle className="size-4 flex-none" aria-hidden="true" />
          <span className="flex-1">{t('innTaken')}</span>
          {openLink(duplicateOf)}
        </p>
      )}

      <PriceListSelect value={f.price_list_id} onChange={(price_list_id) => setF({ ...f, price_list_id })} invalid={invalid.has('price_list_id')} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="customer-days" label={t('paymentDays')} optional={t('optional')} hint={t('paymentDaysHint')} error={invalid.has('payment_days') && t('invalidDays')}>
          <Input value={days} onChange={(e) => (setDays(e.target.value), setInvalid(new Set()))} inputMode="numeric" maxLength={3} autoComplete="off" placeholder="0" />
        </Field>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="customer-limit">
            {t('creditLimit')} <span className="font-normal text-muted-foreground">({t('optional')})</span>
          </Label>
          <div className="flex gap-2">
            <Input
              id="customer-limit"
              value={limit}
              onChange={(e) => (setLimit(e.target.value), setInvalid(new Set()))}
              inputMode="decimal"
              autoComplete="off"
              className="min-w-0 flex-1 text-right tabular-nums"
              aria-invalid={invalid.has('credit_limit') || undefined}
              aria-describedby="customer-limit-hint"
            />
            <Select value={limitCurrency || ownList?.currency || 'UZS'} onValueChange={setLimitCurrency}>
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
          <p id="customer-limit-hint" className={`text-xs ${invalid.has('credit_limit') ? 'text-red' : 'text-muted-foreground'}`}>
            {t(invalid.has('credit_limit') ? 'invalidAmount' : 'creditLimitHint')}
          </p>
        </div>
      </div>

      <Field id="customer-address" label={t('address')} optional={t('optional')}>
        <Input value={f.address} onChange={set('address')} maxLength={500} autoComplete="off" />
      </Field>
      <Field id="customer-note" label={t('note')} optional={t('optional')}>
        <Textarea value={f.note} onChange={set('note')} maxLength={2000} rows={3} />
      </Field>

      {failed && (
        <p role="alert" className="flex items-center gap-2 rounded-2xl bg-red/10 px-3.5 py-2.5 text-sm text-red">
          <AlertCircle className="size-4 flex-none" aria-hidden="true" />
          {t('notSaved')}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          {t('save')}
        </Button>
      </DialogFooter>
    </form>
  )
}

// Which price list this customer buys at. "None" means the company's default, so a later change of
// default applies to them too.
function PriceListSelect({ value, onChange, invalid }: { value: number | null; onChange: (id: number | null) => void; invalid: boolean }) {
  const { t, lang } = usePrefs()
  const lists = useQuery(priceListsQuery)
  const usable = (lists.data ?? []).filter((l) => !l.archived || l.id === value)
  const main = lists.data?.find((l) => l.is_default)
  const label = (l: { name: string; currency: string }) => `${l.name} · ${currencyLabel(l.currency, lang)}`
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor="customer-price-list">{t('priceList')}</Label>
      <Select value={value ? String(value) : 'default'} onValueChange={(v) => onChange(v === 'default' ? null : Number(v))}>
        <SelectTrigger id="customer-price-list" className="w-full" aria-invalid={invalid || undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">{main ? `${label(main)} (${t('byDefault')})` : t('byDefault')}</SelectItem>
          {usable
            .filter((l) => !l.is_default)
            .map((l) => (
              <SelectItem key={l.id} value={String(l.id)}>{label(l)}</SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  )
}
