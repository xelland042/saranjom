// Add or edit a supplier in a dialog. An ИНН already entered for another supplier is refused,
// with a link to that one.
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, invalidFields } from '../../api'
import Field from '../../Field'
import { usePrefs } from '../../prefs'
import { useSupplierMutations, type Supplier, type SupplierFields } from '../../suppliers'

type Props = { open: boolean; onOpenChange: (open: boolean) => void; supplier?: Supplier }

export default function SupplierForm({ open, onOpenChange, supplier }: Props) {
  const { t } = usePrefs()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(supplier ? 'editSupplier' : 'newSupplier')}</DialogTitle>
          <DialogDescription className="sr-only">{t('suppliersIntro')}</DialogDescription>
        </DialogHeader>
        {/* mounted only while open, so every opening starts from the saved values */}
        <Body supplier={supplier} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ supplier, close }: { supplier?: Supplier; close: () => void }) {
  const { t } = usePrefs()
  const navigate = useNavigate()
  const { create, update } = useSupplierMutations()
  const [f, setF] = useState<SupplierFields>(() => ({
    name: supplier?.name ?? '',
    inn: supplier?.inn ?? '',
    phone: supplier?.phone ?? '',
    address: supplier?.address ?? '',
    note: supplier?.note ?? '',
  }))
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const [duplicateOf, setDuplicateOf] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)

  const set = (k: keyof SupplierFields) => (e: { target: { value: string } }) => {
    setF({ ...f, [k]: e.target.value })
    if (invalid.has(k)) setInvalid(new Set([...invalid].filter((x) => x !== k)))
    if (k === 'inn') setDuplicateOf(null)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.name.trim()) return setInvalid(new Set(['name']))
    setFailed(false)
    const onError = (err: unknown) => {
      if (err instanceof ApiError && err.status === 409 && typeof err.body?.id === 'number') setDuplicateOf(err.body.id)
      else if (err instanceof ApiError && err.status === 422) setInvalid(invalidFields(err))
      else setFailed(true)
    }
    const onSuccess = (s: Supplier) => {
      toast.success(t('saved'))
      close()
      if (!supplier) navigate({ to: '/stock/suppliers/$supplierId', params: { supplierId: String(s.id) } })
    }
    if (supplier) update.mutate({ id: supplier.id, ...f }, { onSuccess, onError })
    else create.mutate(f, { onSuccess, onError })
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field id="supplier-name" label={t('supplierName')} error={invalid.has('name') && t('invalidName')}>
        <Input value={f.name} onChange={set('name')} maxLength={200} autoComplete="off" autoFocus />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="supplier-inn" label={t('inn')} optional={t('optional')} hint={t('innHint')} error={invalid.has('inn') && t('invalidInn')}>
          <Input value={f.inn} onChange={set('inn')} inputMode="numeric" maxLength={20} autoComplete="off" />
        </Field>
        <Field id="supplier-phone" label={t('phone')} optional={t('optional')} error={invalid.has('phone') && t('invalidPhone')}>
          <Input value={f.phone} onChange={set('phone')} type="tel" placeholder="+998 90 123 45 67" maxLength={30} autoComplete="off" />
        </Field>
      </div>
      {duplicateOf && (
        <p role="alert" className="flex items-center gap-2 rounded-2xl bg-red/10 px-3.5 py-2.5 text-sm text-red">
          <AlertCircle className="size-4 flex-none" aria-hidden="true" />
          <span className="flex-1">{t('supplierInnTaken')}</span>
          <Link to="/stock/suppliers/$supplierId" params={{ supplierId: String(duplicateOf) }} onClick={close} className="font-medium text-primary underline-offset-4 hover:underline">
            {t('openIt')}
          </Link>
        </p>
      )}
      <Field id="supplier-address" label={t('address')} optional={t('optional')}>
        <Input value={f.address} onChange={set('address')} maxLength={500} autoComplete="off" />
      </Field>
      <Field id="supplier-note" label={t('note')} optional={t('optional')}>
        <Textarea value={f.note} onChange={set('note')} maxLength={2000} rows={2} />
      </Field>
      {failed && (
        <p role="alert" className="flex items-center gap-2 rounded-2xl bg-red/10 px-3.5 py-2.5 text-sm text-red">
          <AlertCircle className="size-4 flex-none" aria-hidden="true" />
          {t('notSaved')}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close}>{t('cancel')}</Button>
        <Button type="submit" disabled={create.isPending || update.isPending}>{t('save')}</Button>
      </DialogFooter>
    </form>
  )
}
