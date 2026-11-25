// Sidebar: a dock of app-style tiles that magnifies under the pointer, and expands into
// a full panel with labels. Item ids are the page ids of the prototype.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Icon } from './parts'
import { initials } from './data'
import { makeLook, type Look } from './looks'
import './sidebar.css'

type Item = { id: string; label: string; icon: string; color: string; badge?: number; alert?: boolean; children?: { label: string; icon: string; color: string }[] }

const FAVORITES: Item[] = [
  { id: 'home', label: 'Home', icon: 'home', color: '#f2733a' },
  { id: 'orders', label: 'Orders', icon: 'box', color: '#3b82f6', badge: 12 },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', color: '#ffffff' },
  { id: 'messages', label: 'Messages', icon: 'chat', color: '#30c35a', badge: 3, alert: true },
]
const WORKSPACE: Item[] = [
  {
    id: 'inventory', label: 'Inventory', icon: 'layers', color: '#8b5cf6',
    children: [
      { label: 'Warehouses', icon: 'warehouse', color: '#f2733a' },
      { label: 'Stock count', icon: 'check', color: '#22b8a0' },
      { label: 'Transfers', icon: 'truck', color: '#8b5cf6' },
    ],
  },
  { id: 'reports', label: 'Reports', icon: 'chart', color: '#22b8a0' },
  { id: 'saved', label: 'Saved', icon: 'bookmark', color: '#f5a524' },
  { id: 'components', label: 'Components', icon: 'grip', color: '#3b82f6' },
]

const vars = (o: Record<string, string | number>) => o as CSSProperties
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform)
// shortcut: read once at load, so the calendar tile doesn't roll over at midnight; use a clock hook in the real app.
const TODAY = new Date()

function Tile({ item, size }: { item: Pick<Item, 'icon' | 'color' | 'id'>; size?: number }) {
  if (item.id === 'calendar') {
    return (
      <span className="tile tile-cal" style={vars({ '--c': item.color, ...(size ? { '--t': `${size}px` } : {}) })} aria-hidden="true">
        <b>{TODAY.toLocaleDateString('en', { weekday: 'short' }).toUpperCase()}</b>
        <span>{TODAY.getDate()}</span>
      </span>
    )
  }
  return (
    <span className="tile" style={vars({ '--c': item.color, ...(size ? { '--t': `${size}px` } : {}) })} aria-hidden="true">
      <Icon name={item.icon} size={size ? Math.round(size * 0.45) : 19} />
    </span>
  )
}

type Props = { active: string; onNavigate: (id: string) => void; look: Look; onLook: (l: Look) => void; user?: { name: string; detail: string } }

export function Sidebar({ active, onNavigate, look, onLook, user = { name: 'Rustam Saidov', detail: 'rustam@baraka.uz' } }: Props) {
  const [open, setOpen] = useState(false)
  const [inventoryOpen, setInventoryOpen] = useState(true)
  const list = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  // Ctrl+K (⌘K on a Mac) opens the panel and focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(true)
        requestAnimationFrame(() => search.current?.focus())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Esc closes it. On narrow screens it covers the page, so a click outside closes it too;
  // on wide screens the page moves aside (sidebar.css), so outside clicks are normal page use.
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: PointerEvent) =>
      !window.matchMedia('(min-width: 1180px)').matches && !panel.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  // Dock magnification: tiles near the pointer grow, like the macOS dock. Writes CSS variables directly,
  // so moving the pointer doesn't re-render React.
  function magnify(e: React.PointerEvent) {
    if (open || !list.current) return
    for (const el of list.current.querySelectorAll<HTMLElement>('.sb-row')) {
      const r = el.getBoundingClientRect()
      const d = Math.abs(e.clientY - (r.top + r.height / 2))
      el.style.setProperty('--s', String(1 + 0.32 * Math.max(0, 1 - d / 110)))
    }
  }
  function unmagnify() {
    list.current?.querySelectorAll<HTMLElement>('.sb-row').forEach((el) => el.style.setProperty('--s', '1'))
  }
  useEffect(unmagnify, [open])

  function row(item: Item) {
    const isActive = active === item.id
    return (
      <div key={item.id} className="sb-item">
        <button
          type="button"
          className="sb-row"
          data-active={isActive}
          aria-current={isActive ? 'page' : undefined}
          data-tip={item.children ? undefined : item.label}
          onClick={() => {
            onNavigate(item.id)
            if (item.children && open) setInventoryOpen((v) => !v)
          }}
          aria-expanded={item.children && open ? inventoryOpen : undefined}
        >
          <span className="sb-dot" aria-hidden="true" />
          <span className="sb-tile-wrap">
            <Tile item={item} />
            {item.badge !== undefined && (
              <b className={`sb-badge ${item.alert ? '' : 'is-quiet'}`} aria-hidden="true">
                {item.badge}
              </b>
            )}
          </span>
          <span className="sb-label">{item.label}</span>
          <span className="sb-trail">
            {item.id === 'calendar' && (
              <span className="sb-time">
                <i /> 10:30
              </span>
            )}
            {item.badge !== undefined && (
              <span className={`sb-count ${item.alert ? 'is-alert' : ''}`} aria-label={`${item.badge} new`}>
                {item.badge}
              </span>
            )}
            {item.children && (
              <span className="sb-chev" data-open={inventoryOpen}>
                <Icon name="chevDown" size={15} />
              </span>
            )}
          </span>
        </button>

        {item.children && (
          <>
            {/* Collapsed: a fly-out next to the tile, on hover or keyboard focus. */}
            <ul className="sb-flyout" aria-label={`${item.label} pages`}>
              {item.children.map((c, i) => (
                <li key={c.label} style={vars({ '--i': i })}>
                  <button type="button" tabIndex={open ? -1 : 0} onClick={() => onNavigate(item.id)}>
                    <Tile item={{ ...c, id: c.label }} size={26} />
                    {c.label}
                  </button>
                </li>
              ))}
            </ul>
            {/* Expanded: the same pages as a nested list that slides open. */}
            <div className="sb-sub" data-open={open && inventoryOpen}>
              <ul>
                {item.children.map((c) => (
                  <li key={c.label}>
                    <button type="button" tabIndex={open && inventoryOpen ? 0 : -1} onClick={() => onNavigate(item.id)}>
                      <Tile item={{ ...c, id: c.label }} size={22} />
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    )
  }

  const frosted = look === 'glass' || look === 'light'
  const light = look === 'light' || look === 'plain'
  return (
    <aside className="sb" ref={panel} data-open={open} aria-label="Main navigation">
      <button type="button" className="sb-toggle" aria-expanded={open} aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'} onClick={() => setOpen((v) => !v)}>
        <Icon name="chev" size={15} />
      </button>

      <div className="sb-brand">
        <span className="tile tile-brand" aria-hidden="true">
          oe
        </span>
        <span className="sb-label sb-brand-text">
          <strong>Saranjom</strong>
          <small>Tashkent wholesale</small>
        </span>
      </div>

      <div className="sb-search" data-tip={`Search  ${IS_MAC ? '⌘' : 'Ctrl+'}K`}>
        <button
          type="button"
          className="sb-search-tile"
          aria-label="Search"
          tabIndex={open ? -1 : 0}
          onClick={() => {
            setOpen(true)
            requestAnimationFrame(() => search.current?.focus())
          }}
        />
        <label className="sb-search-field">
          <Icon name="search" size={16} />
          <input ref={search} placeholder="Search" aria-label="Search" tabIndex={open ? 0 : -1} />
          <kbd>{IS_MAC ? '⌘K' : 'Ctrl K'}</kbd>
        </label>
      </div>

      <nav className="sb-list" ref={list} onPointerMove={magnify} onPointerLeave={unmagnify} aria-label="Pages">
        <p className="sb-section">
          <span>Favorites</span>
        </p>
        {FAVORITES.map(row)}
        <p className="sb-section">
          <span>Workspace</span>
        </p>
        {WORKSPACE.map(row)}
      </nav>

      <button type="button" className="sb-live" data-tip="Delivery run, 4 of 6 stops" data-active={active === 'deliveries'} onClick={() => onNavigate('deliveries')}>
        <span className="tile tile-live" aria-hidden="true">
          <Icon name="truck" size={18} />
        </span>
        <div className="sb-label sb-live-text">
          <strong>
            Delivery run <i className="sb-eq" aria-hidden="true"><b /><b /><b /></i>
          </strong>
          <small>Aziz · 4 of 6 stops</small>
          <span className="sb-progress" role="progressbar" aria-valuenow={4} aria-valuemin={0} aria-valuemax={6} aria-label="Stops done">
            <i style={vars({ '--p': 4 / 6 })} />
          </span>
        </div>
      </button>

      <button
        type="button"
        className="sb-row sb-theme"
        role="switch"
        aria-checked={frosted}
        data-tip={frosted ? 'Turn glass effects off' : 'Turn glass effects on'}
        onClick={() => onLook(makeLook(!frosted, !light))}
      >
        <span className="sb-tile-wrap">
          <span className="tile" style={vars({ '--c': frosted ? '#8b5cf6' : '#6b7280' })} aria-hidden="true">
            <Icon name="layers" size={18} />
          </span>
        </span>
        <span className="sb-label">Glass effects</span>
        <span className="sb-trail">
          <span className="sb-switch" data-on={frosted} aria-hidden="true">
            <i />
          </span>
        </span>
      </button>

      <button
        type="button"
        className="sb-row sb-theme"
        role="switch"
        aria-checked={light}
        data-tip={light ? 'Switch to dark' : 'Switch to light'}
        onClick={() => onLook(makeLook(frosted, light))}
      >
        <span className="sb-tile-wrap">
          <span className="tile" style={vars({ '--c': light ? '#f5a524' : '#3b82f6' })} aria-hidden="true">
            <Icon name={light ? 'sun' : 'moon'} size={18} />
          </span>
        </span>
        <span className="sb-label">Light mode</span>
        <span className="sb-trail">
          <span className="sb-switch" data-on={light} aria-hidden="true">
            <i />
          </span>
        </span>
      </button>

      <div className="sb-user">
        <span className="sb-avatar" aria-hidden="true">
          {initials(user.name)}
          <i />
        </span>
        <span className="sb-label sb-user-text">
          <strong>{user.name}</strong>
          <small>{user.detail}</small>
        </span>
        <span className="sb-trail">
          <Icon name="updown" size={15} />
        </span>
      </div>
    </aside>
  )
}
