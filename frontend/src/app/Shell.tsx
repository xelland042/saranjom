// The logged-in frame: the dock on the left and the page beside it.
// The dock is the prototype's: app-style tiles that grow under the pointer, tooltips while narrow,
// and a toggle that opens it into a labelled panel (remembered in the browser). Ctrl+K opens it on
// the search field, which searches the current section. On phones it slides in, open, from a slim top bar.
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useNavigate, useRouterState } from '@tanstack/react-router'
import { CheckSquare, ChevronRight, KeyRound, LayoutDashboard, Lock, UserCog, ChevronsUpDown, Languages, Layers, LogOut, Menu, Moon, Package, Search, ShoppingCart, Users, Wallet, Warehouse } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
  DropdownMenuCheckboxItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Toaster } from '@/components/ui/sonner'
import type { Me, Permission } from './api'
import { EmptyState } from './Page'
import PasswordDialog from './PasswordDialog'
import { Tile } from './pages/stock/Balances'
import Backdrop from './Backdrop'
import { LANGS, type Key, type Lang } from './i18n'
import { toggleLook, usePrefs } from './prefs'
import { useLogout } from './session'
import { taskSummary } from './tasks'
import '@/playground/spatial.css'
import '@/playground/sidebar.css'
import '@/playground/light.css'
import '@/playground/plain.css'
import './auth.css'
import './shell.css'

// The sections. Each gets a colored tile like the app icons in the prototype.
// `also`: another address that belongs to the same tile
// `need`: the permission a role must have to see the section
type Section = { to: '/' | '/orders' | '/debts' | '/tasks' | '/customers' | '/products' | '/stock' | '/staff'; key: Key; icon: typeof Users; color: string; also?: string; need: Permission }
const NAV: Section[] = [
  { to: '/', key: 'home', icon: LayoutDashboard, color: 'var(--violet)', need: 'dashboard' },
  { to: '/orders', key: 'orders', icon: ShoppingCart, color: 'var(--green)', also: '/returns', need: 'orders.read' },
  { to: '/debts', key: 'debts', icon: Wallet, color: 'var(--gold)', also: '/payments', need: 'money.read' },
  { to: '/tasks', key: 'tasks', icon: CheckSquare, color: 'var(--blue)', need: 'tasks' },
  { to: '/customers', key: 'customers', icon: Users, color: 'var(--accent)', need: 'customers.read' },
  { to: '/products', key: 'products', icon: Package, color: 'var(--violet)', need: 'products.read' },
  { to: '/stock', key: 'stock', icon: Warehouse, color: 'var(--amber)', need: 'stock.read' },
]
// the section an address belongs to (the staff page isn't in the dock, only in the user menu)
const STAFF: Section = { to: '/staff', key: 'staff', icon: UserCog, color: 'var(--accent)', need: 'staff' }
const sectionOf = (path: string) =>
  [...NAV, STAFF].find(({ to, also }) => [to, also].some((p) => p && (path === p || (p !== '/' && path.startsWith(`${p}/`)))))

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform)
const PHONE = '(max-width: 767px)'
// below this the open panel covers the page instead of pushing it aside (shell.css)
const WIDE = '(min-width: 1180px)'

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

function savedOpen() {
  try {
    return localStorage.getItem('dock') === 'open'
  } catch {
    return false
  }
}

function UserMenu({ me }: { me: Me }) {
  const prefs = usePrefs()
  const { t, lang, setLang, frosted, dark } = prefs
  const logout = useLogout()
  const login = me.phone ?? me.email ?? me.username ?? ''
  const [changing, setChanging] = useState(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="sb-user shell-user" aria-label={`${t('account')}: ${me.name}`} data-tip={me.name}>
            <span className="sb-avatar" aria-hidden="true">
              {initials(me.name)}
            </span>
            <span className="sb-label sb-user-text">
              <strong>{me.name}</strong>
              <small>{login}</small>
            </span>
            <span className="sb-trail">
              <ChevronsUpDown className="size-4" aria-hidden="true" />
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" sideOffset={14} className="w-64">
          <DropdownMenuLabel className="grid">
            <span>{me.name}</span>
            <span className="text-xs font-normal text-muted-foreground">{me.company_name}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('appearance')}</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked={frosted} onCheckedChange={(v) => toggleLook(prefs, { frosted: v })} onSelect={(e) => e.preventDefault()}>
            <Layers aria-hidden="true" /> {t('glassEffects')}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={dark} onCheckedChange={(v) => toggleLook(prefs, { dark: v })} onSelect={(e) => e.preventDefault()}>
            <Moon aria-hidden="true" /> {t('darkMode')}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Languages aria-hidden="true" /> {LANGS.find((l) => l.id === lang)?.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={lang} onValueChange={(v) => setLang(v as Lang)}>
                {LANGS.map((l) => (
                  <DropdownMenuRadioItem key={l.id} value={l.id}>{l.label}</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setChanging(true)}>
            <KeyRound aria-hidden="true" /> {t('changePassword')}
          </DropdownMenuItem>
          {me.permissions.includes('staff') && (
            <DropdownMenuItem asChild>
              <Link to="/staff">
                <UserCog aria-hidden="true" /> {t('staff')}
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={logout}>
            <LogOut aria-hidden="true" /> {t('logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PasswordDialog open={changing} onOpenChange={setChanging} />
    </>
  )
}

export default function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const { look, lang, t, dark } = usePrefs()
  const navigate = useNavigate()
  const path = useRouterState({ select: (s) => s.location.pathname })
  // wide screens: the remembered choice; phones: closed until the menu button opens it
  const [open, setOpenState] = useState(() => savedOpen() && !matchMedia(PHONE).matches)
  const [query, setQuery] = useState('')
  // tasks late or due today: a count on the Tasks tile
  const can = (p: Permission) => me.permissions.includes(p)
  const sections = NAV.filter((s) => can(s.need))
  const section = sectionOf(path)
  const summary = useQuery({ ...taskSummary, enabled: can('tasks') }).data
  const due = summary ? summary.overdue + summary.today : 0
  // the dock's search looks in the section you're in: orders, debts and payments by customer,
  // products in products and stock
  const searchIn = (['/stock', '/products', '/orders', '/debts', '/payments'] as const).find((p) => path.startsWith(p)) ?? '/customers'
  const searchLabel: Key = searchIn === '/orders' ? 'searchOrders' : searchIn === '/stock' || searchIn === '/products' ? 'searchProducts' : 'searchCustomers'
  const dock = useRef<HTMLElement>(null)
  const list = useRef<HTMLElement>(null)
  const search = useRef<HTMLInputElement>(null)

  const setOpen = (v: boolean) => {
    setOpenState(v)
    // only a choice made on a computer is remembered; the phone menu always starts closed
    if (matchMedia(PHONE).matches) return
    try {
      localStorage.setItem('dock', v ? 'open' : 'closed')
    } catch {
      // not remembered, still works
    }
  }
  // the field is always in the page (just narrow), so it can take focus right away
  const openOnSearch = () => {
    setOpenState(true)
    search.current?.focus({ preventScroll: true })
  }
  // after following a link: close where the panel covers the page, keep it where it sits beside it
  const afterNavigate = () => !matchMedia(WIDE).matches && setOpen(false)

  // Ctrl+K (⌘K on a Mac) opens the dock on the search field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpenState(true)
        search.current?.focus({ preventScroll: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Escape closes it; so does a click outside where it covers the page. Clicks inside menus that
  // open from the dock (the user menu renders in <body>) don't count as outside.
  useEffect(() => {
    if (!open) return
    // Escape belongs to whatever is on top: a dialog or menu closes first. On wide screens, where the
    // panel sits beside the page, it closes only from inside the dock.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role=dialog], [role=menu], [role=listbox]')) return
      if (matchMedia(WIDE).matches && !dock.current?.contains(document.activeElement)) return
      setOpenState(false)
    }
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element
      if (matchMedia(WIDE).matches || dock.current?.contains(target) || target.closest('[data-radix-popper-content-wrapper]')) return
      setOpenState(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  // Dock magnification: tiles near the pointer grow, like the macOS dock. Writes CSS variables
  // directly, so moving the pointer doesn't re-render React.
  function magnify(e: React.PointerEvent) {
    if (open || e.pointerType !== 'mouse' || !list.current) return
    for (const el of list.current.querySelectorAll<HTMLElement>('.sb-row')) {
      const r = el.getBoundingClientRect()
      const d = Math.abs(e.clientY - (r.top + r.height / 2))
      el.style.setProperty('--s', String(1 + 0.32 * Math.max(0, 1 - d / 110)))
    }
  }
  const unmagnify = () => list.current?.querySelectorAll<HTMLElement>('.sb-row').forEach((el) => el.style.setProperty('--s', '1'))
  useEffect(unmagnify, [open])

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    navigate({ to: searchIn, search: { q: query.trim() || undefined } })
    setQuery('')
    search.current?.blur()
    afterNavigate()
  }

  const shortcut = IS_MAC ? '⌘K' : 'Ctrl K'
  return (
    <div className="sp shell" data-look={look} lang={lang}>
      <Backdrop />

      <header className="shell-top">
        <button type="button" className="icon-btn" aria-label={t('menu')} aria-expanded={open} aria-controls="shell-dock" onClick={() => setOpen(true)}>
          <Menu className="size-5" />
        </button>
        <span className="shell-brand-name">{me.company_name}</span>
      </header>

      {open && <div className="shell-scrim" aria-hidden="true" />}

      <aside id="shell-dock" ref={dock} className="sb" data-open={open} aria-label={t('mainNav')}>
        <button type="button" className="sb-toggle" aria-expanded={open} aria-label={t(open ? 'collapseDock' : 'expandDock')} onClick={() => setOpen(!open)}>
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>

        <div className="sb-brand">
          <span className="tile tile-brand" aria-hidden="true">sa</span>
          <span className="sb-label sb-brand-text">
            <strong className="truncate">{me.company_name}</strong>
            <small>Saranjom</small>
          </span>
        </div>

        <form className="sb-search" role="search" data-tip={`${t(searchLabel)}\n${shortcut}`} onSubmit={submitSearch}>
          <button type="button" className="sb-search-tile" aria-label={t(searchLabel)} tabIndex={open ? -1 : 0} onClick={openOnSearch}>
            <Search className="size-4" />
          </button>
          <label className="sb-search-field">
            <Search className="size-4 flex-none" aria-hidden="true" />
            <input
              ref={search}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(searchIn === '/orders' ? 'searchOrders' : searchIn === '/stock' || searchIn === '/products' ? 'searchProductsShort' : 'searchShort')}
              aria-label={t(searchLabel)}
              tabIndex={open ? 0 : -1}
            />
            <kbd>{shortcut}</kbd>
          </label>
        </form>

        <nav className="sb-list" ref={list} onPointerMove={magnify} onPointerLeave={unmagnify} aria-label={t('mainNav')}>
          {sections.map(({ to, key, icon: Icon, color, also }) => {
            const active = [to, also].some((p) => p && (path === p || (p !== '/' && path.startsWith(`${p}/`))))
            const count = to === '/tasks' ? due : 0
            return (
              <Link key={to} to={to} className="sb-row" data-active={active} aria-current={active ? 'page' : undefined} data-tip={t(key)} onClick={afterNavigate}>
                <span className="sb-dot" aria-hidden="true" />
                <span className="sb-tile-wrap">
                  <span className="tile" style={{ '--c': color } as CSSProperties} aria-hidden="true">
                    <Icon className="size-5" />
                  </span>
                  {count > 0 && (
                    <b className="sb-badge" aria-hidden="true">
                      {count}
                    </b>
                  )}
                </span>
                <span className="sb-label">{t(key)}</span>
                {count > 0 && (
                  <span className="sb-trail">
                    <span className="sb-count is-alert">{count}</span>
                    <span className="sr-only">{t('tasksDueNow')}</span>
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <UserMenu me={me} />
      </aside>

      <main className="shell-main" data-dock={open ? 'open' : 'closed'}>
        {section && !can(section.need) ? (
          // home without the overview: go to the first section the role has; elsewhere, say why
          section.to === '/' && sections[0] ? (
            <Navigate to={sections[0].to} replace />
          ) : (
            <EmptyState icon={<Tile icon={Lock} color="var(--violet)" />} title={t('noAccess')} text={t('noAccessText')} />
          )
        ) : (
          children
        )}
      </main>
      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" />
    </div>
  )
}
