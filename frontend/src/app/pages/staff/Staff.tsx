// The company's people and roles: who they are, how they log in, their role, and whether they
// still may. The owner adds people with a first password (to pass on to them), changes roles, sets
// a new password (which logs them out everywhere) and turns access off; and makes the company's
// own roles, ticking what each sees and changes. Nobody can lock themselves out.
import { useState, type CSSProperties, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Crown, KeyRound, Pencil, Plus, Trash2, UserCog } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { ApiError, invalidFields, type Permission } from '../../api'
import Field from '../../Field'
import { PageHeader } from '../../Page'
import { usePrefs } from '../../prefs'
import { useMe } from '../../session'
import { AREAS, rolesQuery, staffQuery, togglePermission, useStaffMutations, type Person, type Role } from '../../staff'

export default function Staff() {
  const { t } = usePrefs()
  const me = useMe().data
  const people = useQuery(staffQuery)
  const roles = useQuery(rolesQuery)
  const ownerRole = roles.data?.find((r) => r.owner)?.id
  // closing keeps the person, so the dialog's text doesn't change while it fades out
  const [dialog, setDialog] = useState<{ open: boolean; person?: Person }>({ open: false })
  const [roleDialog, setRoleDialog] = useState<{ open: boolean; role?: Role }>({ open: false })
  return (
    <>
      <PageHeader
        title={t('staff')}
        description={t('staffIntro')}
        actions={
          <Button onClick={() => setDialog({ open: true })}>
            <Plus aria-hidden="true" /> {t('addPerson')}
          </Button>
        }
      />
      <section className="glass rise overflow-hidden" style={{ '--i': 1 } as CSSProperties} aria-label={t('staff')}>
        {people.isPending ? (
          <div className="grid gap-3 p-4">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12 rounded-xl" />
            ))}
          </div>
        ) : (
          <ul className="grid">
            {(people.data ?? []).map((p) => (
              <li key={p.id} className={`flex items-center gap-3 border-b border-(--line) px-4 py-3 last:border-0 ${p.active ? '' : 'opacity-60'}`}>
                <span className="grid size-9 flex-none place-items-center rounded-full bg-(--soft-2) text-sm font-semibold" aria-hidden="true">
                  {p.name
                    .split(/\s+/)
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </span>
                <span className="grid min-w-0 flex-1">
                  <span className="truncate font-medium">
                    {p.name}
                    {p.id === me?.id && <span className="text-muted-foreground"> · {t('you')}</span>}
                  </span>
                  <span className="truncate text-xs text-muted-foreground tabular-nums">{p.phone ?? p.email ?? p.username}</span>
                </span>
                {!p.active && <Badge variant="secondary">{t('inactive')}</Badge>}
                <Badge variant={p.role_id === ownerRole ? 'default' : 'secondary'}>{p.role}</Badge>
                <Button size="icon-sm" variant="ghost" aria-label={`${t('edit')}: ${p.name}`} onClick={() => setDialog({ open: true, person: p })}>
                  <Pencil aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="mt-8 mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-0.5">
          <h2 className="text-lg font-semibold">{t('roles')}</h2>
          <p className="text-sm text-muted-foreground">{t('rolesIntro')}</p>
        </div>
        <Button variant="outline" onClick={() => setRoleDialog({ open: true })}>
          <Plus aria-hidden="true" /> {t('newRole')}
        </Button>
      </div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('roles')}>
        {(roles.data ?? []).map((r, i) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRoleDialog({ open: true, role: r })}
            className="glass rise grid content-start gap-2.5 p-4 text-left transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-(--accent)"
            style={{ '--i': i + 2 } as CSSProperties}
          >
            <span className="flex items-center gap-2 font-medium">
              {r.owner ? <Crown className="size-4 text-(--gold)" aria-hidden="true" /> : <UserCog className="size-4 text-muted-foreground" aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {r.people} {t('peopleCount')}
              </span>
            </span>
            <RoleChips role={r} />
          </button>
        ))}
      </section>
      <p className="mt-2 text-xs text-muted-foreground">{t('seeOnlyChange')}</p>
      <PersonDialog open={dialog.open} person={dialog.person} onOpenChange={(open) => setDialog({ ...dialog, open })} />
      <RoleDialog open={roleDialog.open} role={roleDialog.role} onOpenChange={(open) => setRoleDialog({ ...roleDialog, open })} />
    </>
  )
}

function PersonDialog({ open, person, onOpenChange }: { open: boolean; person?: Person; onOpenChange: (o: boolean) => void }) {
  const { t } = usePrefs()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{person ? person.name : t('addPerson')}</DialogTitle>
          <DialogDescription>{t(person ? 'editPersonText' : 'addPersonText')}</DialogDescription>
        </DialogHeader>
        {/* mounted only while open, so every opening starts from the saved values */}
        <Body person={person} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ person, close }: { person?: Person; close: () => void }) {
  const { t } = usePrefs()
  const me = useMe().data
  const { add, update } = useStaffMutations()
  const roles = useQuery(rolesQuery).data ?? []
  const [name, setName] = useState(person?.name ?? '')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  // a new person starts in the first role that isn't the owner's
  const [roleId, setRoleId] = useState<number | null>(person?.role_id ?? null)
  const roleOf = roles.find((r) => r.id === roleId) ?? (person ? undefined : roles.find((r) => !r.owner))
  const role = roleOf?.id
  const [active, setActive] = useState(person?.active ?? true)
  const [bad, setBad] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState<'notSaved' | 'loginTaken' | 'needOwner' | null>(null)
  const self = person?.id === me?.id

  function submit(e: FormEvent) {
    e.preventDefault()
    const errors = new Set<string>()
    if (!name.trim()) errors.add('name')
    if (!person && login.trim().length < 3) errors.add('login')
    if ((!person || password) && password.length < 8) errors.add('password')
    if (!role) errors.add('role_id')
    setBad(errors)
    if (errors.size) return
    setFailed(null)
    const onError = (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) return setFailed('loginTaken')
      const fields = invalidFields(err)
      if (fields.has('role_id')) return setFailed('needOwner')
      if (fields.size) return setBad(fields)
      setFailed('notSaved')
    }
    const onSuccess = () => (toast.success(t('saved')), close())
    if (person)
      update.mutate(
        { id: person.id, name: name.trim(), ...(self ? {} : { role_id: role, active }), ...(password ? { password } : {}) },
        { onSuccess, onError },
      )
    else add.mutate({ name: name.trim(), login: login.trim(), password, role_id: role! }, { onSuccess, onError })
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field id="person-name" label={t('personName')} error={bad.has('name') && t('invalidName')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="off" autoFocus />
      </Field>
      {!person && (
        <Field id="person-login" label={t('login')} hint={t('personLoginHint')} error={bad.has('login') && t('invalid')}>
          <Input value={login} onChange={(e) => setLogin(e.target.value)} maxLength={254} autoComplete="off" />
        </Field>
      )}
      <Field
        id="person-password"
        label={t(person ? 'newPassword' : 'password')}
        optional={person ? t('optional') : undefined}
        hint={t(person ? 'newPasswordHint' : 'firstPasswordHint')}
        error={bad.has('password') && t('passwordHint')}
      >
        <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} autoComplete="new-password" />
      </Field>
      <div className="grid gap-1.5">
        <Label htmlFor="person-role">{t('role')}</Label>
        <Select value={role ? String(role) : undefined} onValueChange={(v) => setRoleId(Number(v))} disabled={self}>
          <SelectTrigger id="person-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {self ? <p className="text-xs text-muted-foreground">{t('ownRoleFixed')}</p> : roleOf && <RoleChips role={roleOf} />}
      </div>
      {person && !self && (
        <label className="flex items-center justify-between gap-3 rounded-2xl bg-(--soft) px-3.5 py-3 text-sm">
          <span className="grid">
            <span className="font-medium">{t('canLogIn')}</span>
            <span className="text-xs text-muted-foreground">{t('canLogInHint')}</span>
          </span>
          <Switch checked={active} onCheckedChange={setActive} />
        </label>
      )}
      {failed && (
        <p role="alert" className="flex items-center gap-2 rounded-2xl bg-red/10 px-3.5 py-2.5 text-sm text-red">
          <AlertCircle className="size-4 flex-none" aria-hidden="true" />
          {t(failed)}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close}>{t('cancel')}</Button>
        <Button type="submit" disabled={add.isPending || update.isPending}>
          {person ? t('save') : (
            <>
              <KeyRound aria-hidden="true" /> {t('addPerson')}
            </>
          )}
        </Button>
      </DialogFooter>
    </form>
  )
}


// what a role gives, area by area: filled when it changes, outlined when it only sees
function RoleChips({ role }: { role: Role }) {
  const { t } = usePrefs()
  if (role.owner) return <span className="text-xs text-muted-foreground">{t('allPermissions')}</span>
  const has = new Set(role.permissions)
  const areas = AREAS.filter((a) => (a.see && has.has(a.see)) || (a.change && has.has(a.change)))
  if (!areas.length) return <span className="text-xs text-muted-foreground">{t('noPermissions')}</span>
  return (
    <span className="flex flex-wrap gap-1">
      {areas.map((a) => {
        const changes = !!a.change && has.has(a.change)
        return (
          <span
            key={a.label}
            className={`rounded-full px-2 py-0.5 text-xs ${changes ? 'bg-(--accent) text-(--on-accent)' : 'border border-(--line) text-muted-foreground'}`}
            title={`${t(a.label)}: ${t(changes ? 'canChange' : 'canSee')}`}
          >
            {t(a.chip)}
          </span>
        )
      })}
    </span>
  )
}

function RoleDialog({ open, role, onOpenChange }: { open: boolean; role?: Role; onOpenChange: (o: boolean) => void }) {
  const { t } = usePrefs()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{role ? role.name : t('newRole')}</DialogTitle>
          <DialogDescription>{t(role?.owner ? 'ownerRoleHint' : 'rolesIntro')}</DialogDescription>
        </DialogHeader>
        <RoleBody role={role} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function RoleBody({ role, close }: { role?: Role; close: () => void }) {
  const { t } = usePrefs()
  const { saveRole, removeRole } = useStaffMutations()
  const [name, setName] = useState(role?.name ?? '')
  const [perms, setPerms] = useState<Set<Permission>>(new Set(role?.permissions ?? []))
  const [bad, setBad] = useState(false)
  const [failed, setFailed] = useState<'notSaved' | 'roleTaken' | 'roleInUse' | null>(null)
  const locked = !!role?.owner

  function submit(e: FormEvent) {
    e.preventDefault()
    setBad(!name.trim())
    if (!name.trim()) return
    setFailed(null)
    saveRole.mutate(
      { id: role?.id, name: name.trim(), ...(locked ? {} : { permissions: [...perms] }) },
      {
        onSuccess: () => (toast.success(t('saved')), close()),
        onError: (err) => setFailed(err instanceof ApiError && err.status === 409 ? 'roleTaken' : 'notSaved'),
      },
    )
  }

  function remove() {
    if (!role) return
    removeRole.mutate(role.id, {
      onSuccess: close,
      onError: (err) => setFailed(invalidFields(err).has('role') ? 'roleInUse' : 'notSaved'),
    })
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field id="role-name" label={t('roleName')} error={bad && t('invalidName')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" autoFocus={!role} />
      </Field>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="pb-2 text-left font-normal" />
            <th className="w-24 pb-2 font-normal">{t('canSee')}</th>
            <th className="w-24 pb-2 font-normal">{t('canChange')}</th>
          </tr>
        </thead>
        <tbody>
          {AREAS.map((a) => (
            <tr key={a.label} className="border-t border-(--line)">
              <th scope="row" className="py-2.5 pr-2 text-left font-normal">{t(a.label)}</th>
              {(['see', 'change'] as const).map((which) => (
                <td key={which} className="text-center">
                  {a[which] && (
                    <Checkbox
                      aria-label={`${t(a.label)}: ${t(which === 'see' ? 'canSee' : 'canChange')}`}
                      checked={locked || perms.has(a[which]!)}
                      disabled={locked}
                      onCheckedChange={(v) => setPerms(togglePermission(perms, a, which, v === true))}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {failed && (
        <p role="alert" className="flex items-center gap-2 rounded-2xl bg-red/10 px-3.5 py-2.5 text-sm text-red">
          <AlertCircle className="size-4 flex-none" aria-hidden="true" />
          {t(failed)}
        </p>
      )}
      <DialogFooter className="sm:justify-between">
        {role && !locked ? (
          <Button type="button" variant="ghost" className="text-red" onClick={remove} disabled={removeRole.isPending}>
            <Trash2 aria-hidden="true" /> {t('delete')}
          </Button>
        ) : (
          <span />
        )}
        <span className="flex gap-2">
          <Button type="button" variant="ghost" onClick={close}>{t('cancel')}</Button>
          <Button type="submit" disabled={saveRole.isPending}>{t('save')}</Button>
        </span>
      </DialogFooter>
    </form>
  )
}
