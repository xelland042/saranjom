// Changing your own password, from the user menu. The current one is asked first; the new one
// ends every other session of yours (the owner resets other people's on the staff page).
import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api, ApiError, invalidFields } from './api'
import Field from './Field'
import { usePrefs } from './prefs'

export default function PasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = usePrefs()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('changePassword')}</DialogTitle>
          <DialogDescription>{t('changePasswordText')}</DialogDescription>
        </DialogHeader>
        {/* mounted only while open, so the fields start empty every time */}
        <Body close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ close }: { close: () => void }) {
  const { t } = usePrefs()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [bad, setBad] = useState<'current' | 'new' | null>(null)
  const [failed, setFailed] = useState<'tooMany' | 'notSaved' | null>(null)
  const change = useMutation({ mutationFn: () => api('/auth/password', { current, new: next }) })

  function submit(e: FormEvent) {
    e.preventDefault()
    setFailed(null)
    if (!current) return setBad('current')
    if (next.length < 8) return setBad('new')
    setBad(null)
    change.mutate(undefined, {
      onSuccess: () => (toast.success(t('passwordChanged')), close()),
      onError: (err) => {
        if (err instanceof ApiError && err.status === 429) return setFailed('tooMany')
        if (invalidFields(err).has('current')) return setBad('current')
        setFailed('notSaved')
      },
    })
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field id="pw-current" label={t('currentPassword')} error={bad === 'current' && t('wrongPassword')}>
        <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} maxLength={128} autoComplete="current-password" autoFocus />
      </Field>
      <Field id="pw-new" label={t('newPassword')} hint={t('passwordHint')} error={bad === 'new' && t('passwordHint')}>
        <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} maxLength={128} autoComplete="new-password" />
      </Field>
      {failed && (
        <p role="alert" className="flex items-center gap-2 rounded-2xl bg-red/10 px-3.5 py-2.5 text-sm text-red">
          <AlertCircle className="size-4 flex-none" aria-hidden="true" />
          {t(failed)}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close}>{t('cancel')}</Button>
        <Button type="submit" disabled={change.isPending}>{t('save')}</Button>
      </DialogFooter>
    </form>
  )
}
