// Add or edit one contact person, and confirm deleting one.
import { useState, type FormEvent } from 'react'
import { AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ApiError, invalidFields } from '../../api'
import { useCustomerMutations, type Contact } from '../../customers'
import Field from '../../Field'
import { usePrefs } from '../../prefs'

type Props = { customerId: number; contact?: Contact; open: boolean; onOpenChange: (open: boolean) => void }

export function ContactForm({ customerId, contact, open, onOpenChange }: Props) {
  const { t } = usePrefs()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(contact ? 'editContact' : 'newContact')}</DialogTitle>
          <DialogDescription className="sr-only">{t('noContactsText')}</DialogDescription>
        </DialogHeader>
        <Body customerId={customerId} contact={contact} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ customerId, contact, close }: { customerId: number; contact?: Contact; close: () => void }) {
  const { t } = usePrefs()
  const { saveContact } = useCustomerMutations()
  const [f, setF] = useState({ name: contact?.name ?? '', phone: contact?.phone ?? '', position: contact?.position ?? '' })
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setF({ ...f, [k]: e.target.value })
    setInvalid(new Set([...invalid].filter((x) => x !== k)))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!f.name.trim()) return setInvalid(new Set(['name']))
    setFailed(false)
    saveContact.mutate(
      { customerId, id: contact?.id, ...f },
      {
        onSuccess: () => {
          toast.success(t('saved'))
          close()
        },
        onError: (err) => (err instanceof ApiError && err.status === 422 ? setInvalid(invalidFields(err)) : setFailed(true)),
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field id="contact-name" label={t('contactName')} error={invalid.has('name') && t('invalidName')}>
        <Input value={f.name} onChange={set('name')} maxLength={200} autoComplete="off" autoFocus />
      </Field>
      <Field id="contact-position" label={t('position')} optional={t('optional')}>
        <Input value={f.position} onChange={set('position')} maxLength={500} autoComplete="off" />
      </Field>
      <Field id="contact-phone" label={t('phone')} optional={t('optional')} error={invalid.has('phone') && t('invalidPhone')}>
        <Input value={f.phone} onChange={set('phone')} type="tel" placeholder="+998 90 123 45 67" maxLength={30} autoComplete="off" />
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
        <Button type="submit" disabled={saveContact.isPending}>
          {t('save')}
        </Button>
      </DialogFooter>
    </form>
  )
}

type DeleteProps = { customerId: number; contact?: Contact; open: boolean; onOpenChange: (open: boolean) => void }

export function DeleteContact({ customerId, contact, open, onOpenChange }: DeleteProps) {
  const { t } = usePrefs()
  const { deleteContact } = useCustomerMutations()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('deleteContactQ')}</DialogTitle>
          <DialogDescription>
            {contact?.name}. {t('deleteContactText')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={deleteContact.isPending}
            onClick={() =>
              contact &&
              deleteContact.mutate(
                { customerId, id: contact.id },
                { onSuccess: () => onOpenChange(false), onError: () => toast.error(t('notSaved')) },
              )
            }
          >
            {t('delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
