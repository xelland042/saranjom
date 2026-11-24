// Login and sign-up: one compact card over the app's backdrop. One login box takes a phone, email or username.
// The banner is alive: its colors and greeting follow the time of day, it shows a clock, its headline
// follows the tab, and it greets the last person who logged in on this browser.
import { useEffect, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, AtSign, Eye, EyeOff, Languages, Layers, Loader2, Moon, Phone, Square, Sun, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, ApiError, type Me } from './api'
import Backdrop from './Backdrop'
import { formatDate } from './dates'
import { LANGS, type Key } from './i18n'
import { toggleLook, usePrefs } from './prefs'
import { meQuery } from './session'
import '@/playground/spatial.css'
import '@/playground/sidebar.css'
import '@/playground/light.css'
import '@/playground/plain.css'
import './auth.css'

type T = (k: Key) => string
type Tab = 'login' | 'signup'

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function errorKey(e: unknown): Key {
  if (!(e instanceof ApiError)) return 'offline'
  if (e.status === 401) return 'wrong'
  if (e.status === 409) return 'taken'
  if (e.status === 429) return 'tooMany'
  if (e.status === 422) return 'invalid'
  return 'offline'
}

// ---------- remembered last user (name and login only, never the password) ----------

type LastUser = { name: string; login: string }

function readLastUser(): LastUser | null {
  try {
    const v = JSON.parse(localStorage.getItem('last-user') ?? 'null')
    return v && typeof v.name === 'string' && typeof v.login === 'string' ? v : null
  } catch {
    return null
  }
}

function writeLastUser(v: LastUser | null) {
  try {
    if (v) localStorage.setItem('last-user', JSON.stringify(v))
    else localStorage.removeItem('last-user')
  } catch {
    // not remembered, nothing else breaks
  }
}

// ---------- time of day ----------

type Phase = 'morning' | 'day' | 'evening' | 'night'
const phaseOf = (h: number): Phase => (h < 5 ? 'night' : h < 11 ? 'morning' : h < 17 ? 'day' : h < 22 ? 'evening' : 'night')
const GREETING: Record<Phase, Key> = { morning: 'goodMorning', day: 'goodDay', evening: 'goodEvening', night: 'goodNight' }
const pad = (n: number) => String(n).padStart(2, '0')

// The current minute, refreshed on the minute.
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>
    const tick = () => {
      setNow(new Date())
      id = setTimeout(tick, 60_000 - (Date.now() % 60_000))
    }
    id = setTimeout(tick, 60_000 - (Date.now() % 60_000))
    return () => clearTimeout(id)
  }, [])
  return now
}

// ---------- pieces ----------

// The last word of the headline rolls through what Saranjom keeps in one place.
function RollingWord({ words }: { words: string[] }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (reducedMotion()) return
    const id = setInterval(() => setI((n) => n + 1), 2400)
    return () => clearInterval(id)
  }, [])
  if (reducedMotion()) return <span className="auth-word-static">{words.join(' ')}</span>
  return (
    <span className="auth-word" aria-live="off">
      <span key={i} className="auth-word-in">{words[i % words.length]}</span>
    </span>
  )
}

// A rough mirror of parse_login on the server, only to pick the icon; the server decides.
function loginKind(v: string): 'phone' | 'email' | 'username' {
  if (v.includes('@')) return 'email'
  if (v.trim() && /^[\d\s()+-]+$/.test(v)) return 'phone'
  return 'username'
}
const KIND_ICON = { phone: Phone, email: AtSign, username: User }
const KIND_LABEL: Record<'phone' | 'email' | 'username', Key> = { phone: 'asPhone', email: 'asEmail', username: 'asUsername' }

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}

function LoginInput({ id, t, hint, initial = '' }: { id: string; t: T; hint?: boolean; initial?: string }) {
  const [value, setValue] = useState(initial)
  const kind = loginKind(value)
  const KindIcon = KIND_ICON[kind]
  return (
    <div className="relative">
      <KindIcon
        key={kind}
        className="auth-kind pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        id={id}
        name="login"
        required
        autoComplete="username"
        className="pl-10"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {/* tells screen reader users which kind of login was recognized */}
      <span className="sr-only" aria-live="polite">
        {value ? t(KIND_LABEL[kind]) : ''}
      </span>
    </div>
  )
}

function PasswordInput({ id, t, newPassword, autoFocus }: { id: string; t: T; newPassword?: boolean; autoFocus?: boolean }) {
  const [shown, setShown] = useState(false)
  const [caps, setCaps] = useState(false)
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState('CapsLock'))
  return (
    <>
      <div className="relative">
        <Input
          id={id}
          name="password"
          required
          autoFocus={autoFocus}
          type={shown ? 'text' : 'password'}
          autoComplete={newPassword ? 'new-password' : 'current-password'}
          minLength={newPassword ? 8 : undefined}
          className="pr-11"
          onKeyDown={onKey}
          onKeyUp={onKey}
          onBlur={() => setCaps(false)}
          aria-describedby={newPassword ? `${id}-hint` : undefined}
        />
        <button
          type="button"
          className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t(shown ? 'hidePassword' : 'showPassword')}
          aria-pressed={shown}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {caps && (
        <p className="text-xs text-amber" role="status">
          {t('capsLock')}
        </p>
      )}
    </>
  )
}

// Icon buttons for Glass/Plain, Light/Dark and language. The icon shows what you switch to.
function Controls() {
  const prefs = usePrefs()
  const { lang, setLang, t, dark, frosted } = prefs
  const next = LANGS[(LANGS.findIndex((l) => l.id === lang) + 1) % LANGS.length]
  return (
    <div className="flex items-center gap-1">
      <Button type="button" size="icon-sm" variant="ghost" title={t(frosted ? 'plain' : 'glass')} aria-label={t(frosted ? 'plain' : 'glass')} onClick={() => toggleLook(prefs, { frosted: !frosted })}>
        {frosted ? <Square key="p" className="auth-kind" /> : <Layers key="g" className="auth-kind" />}
      </Button>
      <Button type="button" size="icon-sm" variant="ghost" title={t(dark ? 'light' : 'dark')} aria-label={t(dark ? 'light' : 'dark')} onClick={() => toggleLook(prefs, { dark: !dark })}>
        {dark ? <Sun key="s" className="auth-kind" /> : <Moon key="m" className="auth-kind" />}
      </Button>
      <Button type="button" size="sm" variant="ghost" title={next.label} aria-label={`${t('language')}: ${next.label}`} onClick={() => setLang(next.id)}>
        <Languages aria-hidden="true" />
        {lang === 'uz' ? 'Oʻz' : lang === 'uz-Cyrl' ? 'Ўз' : 'Ру'}
      </Button>
    </div>
  )
}

function Banner({ tab, last }: { tab: Tab; last: LastUser | null }) {
  const { lang, t } = usePrefs()
  const now = useNow()
  const phase = phaseOf(now.getHours())
  const firstName = last?.name.split(' ')[0]
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const date = formatDate(now, lang)
  return (
    <div className="auth-hero auth-dots auth-sweep relative grid gap-4 overflow-hidden px-7 pt-6 pb-7" data-phase={phase} data-tab={tab}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="tile tile-brand" style={{ '--t': '32px' } as CSSProperties} aria-hidden="true">sa</span>
          <span className="text-lg font-semibold">Saranjom</span>
        </div>
        <Controls />
      </div>
      <div className="grid gap-1.5">
        <p className="text-sm text-muted-foreground">
          {t(GREETING[phase])}
          {firstName && tab === 'login' ? `, ${firstName}` : ''}
          <span aria-hidden="true"> · </span>
          <time dateTime={now.toISOString()}>{time}, {date}</time>
        </p>
        {/* key: the headline fades in again when the tab or language changes */}
        {/* always two lines tall, so the rolling word or the tab can't make the form below jump */}
        <h1 key={`${tab}-${lang}`} className="auth-fade min-h-[2lh] text-2xl leading-tight font-semibold tracking-tight">
          {tab === 'login' ? (
            <>
              {t('everything')}
              <br />
              <RollingWord words={t('words').split('|')} />
            </>
          ) : (
            t('createCompany')
          )}
        </h1>
      </div>
    </div>
  )
}

// ---------- screen ----------

export default function Auth() {
  const { look, lang, t } = usePrefs()
  const qc = useQueryClient()
  const onAuthed = (me: Me) => qc.setQueryData(meQuery.queryKey, me)
  const [tab, setTab] = useState<Tab>('login')
  const [error, setError] = useState<Key | null>(null)
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<LastUser | null>(readLastUser)

  // The wallpaper drifts a few pixels with the pointer, as in the app. The card itself stays still.
  function onPointer(e: React.PointerEvent<HTMLDivElement>) {
    const el = e.currentTarget
    el.style.setProperty('--px', `${(e.clientX / window.innerWidth - 0.5) * -7}px`)
    el.style.setProperty('--py', `${(e.clientY / window.innerHeight - 0.5) * -5}px`)
  }

  async function submit(e: FormEvent<HTMLFormElement>, path: string) {
    e.preventDefault()
    const form = e.currentTarget
    const card = form.closest('main')
    setBusy(true)
    setError(null)
    try {
      await api(path, Object.fromEntries(new FormData(form)))
      const me = await api<Me>('/auth/me')
      writeLastUser({ name: me.name, login: String(new FormData(form).get('login') ?? '') })
      onAuthed(me)
    } catch (err) {
      setError(errorKey(err))
      setBusy(false)
      if (!reducedMotion()) {
        card?.animate([0, -8, 7, -5, 3, 0].map((x) => ({ translate: `${x}px 0` })), { duration: 380, easing: 'ease-out' })
      }
    }
  }

  function forget() {
    writeLastUser(null)
    setLast(null)
  }

  const submitButton = (label: Key) => (
    <Button type="submit" disabled={busy} className="mt-1">
      {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
      {t(label)}
    </Button>
  )

  return (
    <div className="sp" data-look={look} lang={lang} onPointerMove={onPointer}>
      <Backdrop />

      <div className="grid min-h-screen place-items-center px-4 py-10">
        <main className="glass rise auth-card w-full max-w-sm overflow-hidden">
          <Banner tab={tab} last={last} />

          <div className="grid gap-5 p-7">
            <Tabs value={tab} onValueChange={(v) => { setTab(v as Tab); setError(null) }}>
              <TabsList className="w-full">
                <TabsTrigger value="login">{t('loginTab')}</TabsTrigger>
                <TabsTrigger value="signup">{t('signupTab')}</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <form className="mt-4 grid gap-4" onSubmit={(e) => submit(e, '/auth/login')}>
                  <Field id="auth-login-login" label={t('login')}>
                    {/* key: forgetting the last user clears the prefilled login */}
                    <LoginInput key={last?.login ?? ''} id="auth-login-login" t={t} initial={last?.login} />
                  </Field>
                  <Field id="auth-login-password" label={t('password')}>
                    <PasswordInput id="auth-login-password" t={t} autoFocus={!!last} />
                  </Field>
                  {submitButton('submitLogin')}
                  {last && (
                    <button type="button" className="justify-self-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={forget}>
                      {t('notYou')}
                    </button>
                  )}
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form className="mt-4 grid gap-4" onSubmit={(e) => submit(e, '/auth/signup')}>
                  <Field id="auth-signup-company_name" label={t('company')}>
                    <Input id="auth-signup-company_name" name="company_name" required maxLength={200} autoComplete="organization" />
                  </Field>
                  <Field id="auth-signup-name" label={t('name')}>
                    <Input id="auth-signup-name" name="name" required maxLength={200} autoComplete="name" />
                  </Field>
                  <Field id="auth-signup-login" label={t('login')} hint={t('loginHint')}>
                    <LoginInput id="auth-signup-login" t={t} hint />
                  </Field>
                  <Field id="auth-signup-password" label={t('password')} hint={t('passwordHint')}>
                    <PasswordInput id="auth-signup-password" t={t} newPassword />
                  </Field>
                  {/* names the app creates for the new company (the default price list) use this language */}
                  <input type="hidden" name="lang" value={lang} />
                  {submitButton('submitSignup')}
                </form>
              </TabsContent>
            </Tabs>

            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-2xl bg-red/10 px-3.5 py-2.5 text-sm text-red">
                <AlertCircle className="mt-0.5 size-4 flex-none" aria-hidden="true" />
                {t(error)}
              </p>
            )}
            <p className="text-center text-xs text-muted-foreground">Saranjom · AGPL-3.0</p>
          </div>
        </main>
      </div>
    </div>
  )
}
