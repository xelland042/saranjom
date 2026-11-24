// Glass prototype: panels floating over a room scene, with a top nav, a left sidebar
// and three working pages (Home, Messages, Saved). Each page has an address, like /#/messages.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { LogOut } from 'lucide-react'
import { Icon, Scene } from './parts'
import { Sidebar } from './Sidebar'
import Kit from './Kit'
import { lookPrefix, type Look } from './looks'
import { move, parseLayout, type Widget } from './layout'
import {
  activity, chats, firstMessages, goal, initials, kpis, rangeChange, rangeUnit, replies, salesByRange,
  saved as savedSeed, suggestions, team, today, type Message, type Range, type Saved,
} from './data'
import './spatial.css'
import './light.css'
import './plain.css'

type Page = 'home' | 'orders' | 'invoices' | 'settings' | 'messages' | 'calendar' | 'deliveries' | 'saved' | 'inventory' | 'reports' | 'components'

const TOP: { id: Page; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'orders', label: 'Orders', icon: 'box' },
  { id: 'invoices', label: 'Invoices', icon: 'receipt' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
]
const NAMES: Record<Page, string> = {
  home: 'Home', orders: 'Orders', invoices: 'Invoices', settings: 'Settings', messages: 'Messages',
  calendar: 'Calendar', deliveries: 'Deliveries', saved: 'Saved', inventory: 'Inventory', reports: 'Reports',
  components: 'Components',
}
const ICONS: Record<Page, string> = {
  home: 'home', orders: 'box', invoices: 'receipt', settings: 'gear', messages: 'chat',
  calendar: 'calendar', deliveries: 'truck', saved: 'bookmark', inventory: 'layers', reports: 'chart',
  components: 'grip',
}

// CSS custom properties need a cast to pass through React's style prop.
const vars = (o: Record<string, string | number>) => o as CSSProperties

// shortcut: read once at load, so greeting and "today" don't update past midnight; use a clock hook in the real app.
const LOADED = new Date()

// Measures the active item in a group, so one highlight can slide between items.
function useIndicator(active: string) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current?.querySelector<HTMLElement>('[data-active="true"]')
      setBox(el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [active])
  const style: CSSProperties = box
    ? { transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }
    : { opacity: 0 }
  return [ref, style] as const
}

function Avatar({ name, size = 32, online }: { name: string; size?: number; online?: boolean }) {
  // Hue from the name, so each person keeps the same color everywhere.
  const hue = [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 360
  return (
    <span className="avatar" style={vars({ '--size': `${size}px`, '--hue': hue })}>
      {initials(name)}
      {online !== undefined && <i className={online ? 'is-online' : ''} aria-label={online ? 'Online' : 'Offline'} />}
    </span>
  )
}

function Segmented<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const [ref, ind] = useIndicator(value)
  return (
    <div className="seg" ref={ref} role="group" aria-label={label}>
      <span className="seg-ind" style={ind} aria-hidden="true" />
      {options.map((o) => (
        <button key={o.id} type="button" data-active={o.id === value} aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------------- Home ---------------- */

function Spark({ values, tone }: { values: readonly number[]; tone: string }) {
  const max = Math.max(...values)
  const min = Math.min(...values)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 96},${32 - ((v - min) / (max - min || 1)) * 28}`)
  return (
    <svg className={`spark tone-${tone}`} viewBox="-2 -2 100 38" aria-hidden="true">
      <polyline points={pts.join(' ')} pathLength={1} />
    </svg>
  )
}

function SalesChart({ range }: { range: Range }) {
  const data = salesByRange[range]
  const unit = rangeUnit[range]
  const top = Math.max(...data.map((d) => d.value))
  const step = 10 ** Math.floor(Math.log10(top))
  const max = Math.ceil(top / step) * step
  const current = range === 'week' ? (LOADED.getDay() + 6) % 7 : range === 'month' ? data.length - 1 : 10
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
  return (
    <div className="sp-chart" key={range}>
      <div className="chart-grid" aria-hidden="true">
        {[1, 0.75, 0.5, 0.25, 0].map((t) => (
          <span key={t} style={vars({ '--t': t })}>
            {fmt(max * t)}
          </span>
        ))}
      </div>
      <div className="bars">
        {data.map((d, i) => (
          <button
            key={d.label}
            type="button"
            className="bar-col"
            data-current={i === current}
            aria-label={`${d.label}: ${d.value} ${unit}`}
            style={vars({ '--h': d.value / max, '--i': i })}
          >
            <span className="sp-bar" />
            <span className="bar-tip">
              {fmt(d.value)} {unit}
            </span>
            <span className="bar-label">{d.label.replace('Week ', 'W')}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function exportCsv(range: Range) {
  const rows = [['Period', `Sales (${rangeUnit[range]})`], ...salesByRange[range].map((d) => [d.label, String(d.value)])]
  const url = URL.createObjectURL(new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `sales-${range}.csv` })
  a.click()
  URL.revokeObjectURL(url)
}

// Home is a dashboard of widgets. In edit mode they can be dragged, resized, removed and added back.
// Width is in columns of four; height is in rows of 80px, which grow if the content needs more.
type WDef = { title: string; sizes: readonly number[]; rows: number; cls: string; body: (range: Range) => ReactNode }

const RANGE_NAME: Record<Range, string> = { week: 'this week', month: 'this month', year: 'this year' }

const WIDGETS: Record<string, WDef> = {
  ...Object.fromEntries(
    kpis.map((k) => [
      `kpi-${k.id}`,
      {
        title: k.label,
        sizes: [1, 2],
        rows: 2,
        cls: 'sp-kpi',
        body: () => (
          <>
            <div className="kpi-top">
              <span className={`kpi-icon tone-${k.tone}`}>
                <Icon name={k.icon} />
              </span>
              <Icon name="arrow" size={16} />
            </div>
            <p className="sp-kpi-label">{k.label}</p>
            <div className="kpi-row">
              <div>
                <strong className="sp-kpi-value">{k.value}</strong>
                <span className={`chip ${k.change >= 0 ? 'up' : 'down'}`}>
                  {k.change >= 0 ? '▲' : '▼'} {Math.abs(k.change)}%
                </span>
              </div>
              <Spark values={k.spark} tone={k.tone} />
            </div>
          </>
        ),
      } satisfies WDef,
    ]),
  ),
  sales: {
    title: 'Sales chart',
    sizes: [2, 3, 4],
    rows: 5,
    cls: 'panel sales',
    body: (range) => (
      <>
        <div className="panel-head">
          <div>
            <h2>Sales {RANGE_NAME[range]}</h2>
            <p>In {rangeUnit[range]}, current period highlighted</p>
          </div>
          <span className="chip up">
            ▲ {rangeChange[range]}% vs last {range}
          </span>
        </div>
        <SalesChart range={range} />
      </>
    ),
  },
  today: {
    title: 'Today',
    sizes: [1, 2],
    rows: 5,
    cls: 'panel today',
    body: () => (
      <>
        <div className="panel-head">
          <div>
            <h2>Today</h2>
            <p>{LOADED.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Add event">
            <Icon name="plus" size={16} />
          </button>
        </div>
        <ol className="timeline">
          {today.map((e) => (
            <li key={e.title}>
              <time>{e.time}</time>
              <div className={`event tone-${e.tone}`}>
                <strong>{e.title}</strong>
                <small>{e.meta}</small>
                <span className="faces">
                  {e.people.map((p) => (
                    <Avatar key={p} name={p} size={22} />
                  ))}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </>
    ),
  },
  activity: {
    title: 'Recent activity',
    sizes: [2, 4],
    rows: 3,
    cls: 'panel activity',
    body: () => (
      <>
        <div className="panel-head">
          <h2>Recent activity</h2>
        </div>
        <ul className="rows">
          {activity.map((a) => (
            <li key={a.target + a.when}>
              <Avatar name={a.who} />
              <p>
                <strong>{a.who}</strong> {a.what} <strong>{a.target}</strong>
              </p>
              <small>{a.when}</small>
            </li>
          ))}
        </ul>
      </>
    ),
  },
  team: {
    title: 'Team',
    sizes: [1, 2],
    rows: 3,
    cls: 'panel',
    body: () => (
      <>
        <div className="panel-head">
          <div>
            <h2>Team</h2>
            <p>{team.filter((t) => t.online).length} online now</p>
          </div>
        </div>
        <ul className="rows">
          {team.map((t) => (
            <li key={t.name}>
              <Avatar name={t.name} online={t.online} />
              <p>
                <strong>{t.name}</strong>
                <small>{t.role}</small>
              </p>
              <button type="button" className="icon-btn" aria-label={`Call ${t.name}`}>
                <Icon name="phone" size={15} />
              </button>
            </li>
          ))}
        </ul>
      </>
    ),
  },
  goal: {
    title: 'Goal',
    sizes: [1, 2],
    rows: 3,
    cls: 'panel goal',
    body: () => (
      <>
        <div className="panel-head">
          <div>
            <h2>Goal</h2>
            <p>{goal.label}</p>
          </div>
        </div>
        <div className="ring" style={vars({ '--done': goal.done })}>
          <svg viewBox="0 0 80 80" aria-hidden="true">
            <circle cx="40" cy="40" r="34" pathLength={100} />
            <circle cx="40" cy="40" r="34" pathLength={100} className="ring-fill" />
          </svg>
          <strong>{goal.done}%</strong>
        </div>
        <p className="goal-note">5.1B of 6.2B soʻm, 18 days left</p>
      </>
    ),
  },
}
const SIZES = Object.fromEntries(Object.entries(WIDGETS).map(([id, w]) => [id, w.sizes]))
const DEFAULT_LAYOUT: Widget[] = [
  ...kpis.map((k) => ({ id: `kpi-${k.id}`, size: 1 })),
  { id: 'sales', size: 3 },
  { id: 'today', size: 1 },
  { id: 'activity', size: 2 },
  { id: 'team', size: 1 },
  { id: 'goal', size: 1 },
]
// shortcut: the layout is saved in this browser only; save it per user on the server once there are logins.
const LAYOUT_KEY = 'oe.home.layout'
function loadLayout() {
  try {
    return parseLayout(localStorage.getItem(LAYOUT_KEY), SIZES) ?? DEFAULT_LAYOUT
  } catch {
    return DEFAULT_LAYOUT
  }
}
const SPRING = 'cubic-bezier(.32, 1.25, .5, 1)'
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function Home() {
  const [range, setRange] = useState<Range>('week')
  const [editing, setEditing] = useState(false)
  const [layout, setLayoutState] = useState(loadLayout)
  const [leaving, setLeaving] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const grid = useRef<HTMLDivElement>(null)
  const before = useRef(new Map<string, DOMRect>())
  const drag = useRef<{ id: string; el: HTMLElement; grabX: number; grabY: number; x: number; y: number; over: string | null } | null>(null)
  const hour = LOADED.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const hidden = Object.keys(WIDGETS).filter((id) => !layout.some((w) => w.id === id))

  const widgets = () => [...(grid.current?.querySelectorAll<HTMLElement>('[data-w]') ?? [])]

  // The dragged widget follows the pointer. Positions come from offsetLeft/Top, which ignore transforms,
  // so a widget that is still sliding doesn't confuse the hit test.
  function follow() {
    const d = drag.current
    if (d) d.el.style.translate = `${d.x - d.grabX - d.el.offsetLeft}px ${d.y - d.grabY - d.el.offsetTop}px`
  }
  // Layout changes animate with FLIP: remember where each widget is, let React move it,
  // then slide it from the old spot to the new one.
  function setLayout(next: Widget[]) {
    before.current = new Map(widgets().map((el) => [el.dataset.w!, el.getBoundingClientRect()]))
    setLayoutState(next)
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next))
    } catch {
      /* storage blocked: the layout still works until reload */
    }
  }
  useLayoutEffect(() => {
    follow()
    for (const el of widgets()) {
      const old = before.current.get(el.dataset.w!)
      if (!old || el.dataset.w === drag.current?.id || calm()) continue
      const now = el.getBoundingClientRect()
      const dx = old.left - now.left
      const dy = old.top - now.top
      if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 560, easing: SPRING })
      if (Math.round(old.width) !== Math.round(now.width)) {
        el.animate([{ opacity: 0.5, scale: '0.96' }, { opacity: 1, scale: '1' }], { duration: 420, easing: SPRING })
      }
    }
    before.current.clear()
  }, [layout])

  function startDrag(e: React.PointerEvent<HTMLElement>, id: string) {
    if (!editing || e.button !== 0 || (e.target as Element).closest('button:not(.w-handle)')) return
    const el = e.currentTarget
    const g = grid.current!.getBoundingClientRect()
    const x = e.clientX - g.left
    const y = e.clientY - g.top
    drag.current = { id, el, grabX: x - el.offsetLeft, grabY: y - el.offsetTop, x, y, over: null }
    el.setPointerCapture(e.pointerId)
    el.dataset.dragging = 'true'
    e.preventDefault()
  }
  function dragMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const g = grid.current!.getBoundingClientRect()
    d.x = e.clientX - g.left
    d.y = e.clientY - g.top
    follow()
    const over = widgets().find(
      (o) => o !== d.el && d.x >= o.offsetLeft && d.x < o.offsetLeft + o.offsetWidth && d.y >= o.offsetTop && d.y < o.offsetTop + o.offsetHeight,
    )?.dataset.w
    // Swap once per widget entered; otherwise two widgets of different sizes keep swapping back and forth.
    if (over === d.over) return
    d.over = over ?? null
    if (over) setLayout(move(layout, layout.findIndex((w) => w.id === d.id), layout.findIndex((w) => w.id === over)))
  }
  function drop() {
    const d = drag.current
    if (!d) return
    drag.current = null
    const from = d.el.getBoundingClientRect()
    d.el.style.translate = ''
    delete d.el.dataset.dragging
    const to = d.el.getBoundingClientRect()
    if (!calm()) d.el.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], { duration: 480, easing: SPRING })
  }

  function nudge(e: React.KeyboardEvent, i: number) {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key]
    if (!step || i + step < 0 || i + step >= layout.length) return
    e.preventDefault()
    setLayout(move(layout, i, i + step))
    setNote(`${WIDGETS[layout[i].id].title} moved to position ${i + step + 1} of ${layout.length}`)
    // Keep focus on the handle, which React keeps because the widget is keyed.
  }
  function resize(w: Widget) {
    const s = WIDGETS[w.id].sizes
    const size = s[(s.indexOf(w.size) + 1) % s.length]
    setLayout(layout.map((x) => (x.id === w.id ? { ...x, size } : x)))
    setNote(`${WIDGETS[w.id].title} is now ${size} column${size > 1 ? 's' : ''} wide`)
  }
  function remove(id: string) {
    setLeaving(id)
    setTimeout(() => {
      setLeaving(null)
      setLayout(layout.filter((w) => w.id !== id))
      setNote(`${WIDGETS[id].title} removed`)
    }, calm() ? 0 : 220)
  }
  function add(id: string) {
    setAdded(id)
    setLayout([...layout, { id, size: DEFAULT_LAYOUT.find((w) => w.id === id)!.size }])
    setNote(`${WIDGETS[id].title} added at the end`)
  }

  return (
    <>
      <header className="page-head rise" style={vars({ '--i': 0 })}>
        <div>
          <h1>{editing ? 'Customize Home' : `${greeting}, Rustam`}</h1>
          <p>{editing ? 'Drag widgets to move them. Resize, remove or add them back.' : `Sales are up ${rangeChange.week}% on last week. Two invoices are overdue.`}</p>
        </div>
        <div className="head-actions">
          {editing ? (
            <>
              <button type="button" className="pill-btn" onClick={() => setLayout(DEFAULT_LAYOUT)}>
                Reset
              </button>
              <button type="button" className="pill-btn primary" onClick={() => setEditing(false)}>
                <Icon name="check" size={16} /> Done
              </button>
            </>
          ) : (
            <>
              <Segmented
                label="Period"
                value={range}
                onChange={setRange}
                options={[
                  { id: 'week', label: 'Week' },
                  { id: 'month', label: 'Month' },
                  { id: 'year', label: 'Year' },
                ]}
              />
              <button type="button" className="pill-btn" onClick={() => exportCsv(range)}>
                <Icon name="download" size={16} /> Export CSV
              </button>
              <button type="button" className="pill-btn" onClick={() => setEditing(true)}>
                <Icon name="layers" size={16} /> Customize
              </button>
            </>
          )}
        </div>
      </header>

      <div className="w-tray" data-open={editing} inert={!editing}>
        <div>
          <div className="glass w-tray-inner">
            <span>{hidden.length ? 'Add a widget' : 'Every widget is on the page. Remove one and it waits here.'}</span>
            {hidden.map((id, n) => (
              <button key={id} type="button" className="pill-btn w-add" style={vars({ '--n': n })} onClick={() => add(id)}>
                <Icon name="plus" size={15} /> {WIDGETS[id].title}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="home-grid" ref={grid} data-editing={editing}>
        {layout.map((w, i) => {
          const def = WIDGETS[w.id]
          return (
            <article
              key={w.id}
              data-w={w.id}
              data-span={w.size}
              data-leaving={leaving === w.id}
              className={`glass w ${def.cls} rise`}
              style={vars({ '--i': w.id === added ? 0 : i + 1, '--span': w.size, '--rows': def.rows })}
              aria-label={def.title}
              onPointerDown={(e) => startDrag(e, w.id)}
              onPointerMove={dragMove}
              onPointerUp={drop}
              onPointerCancel={drop}
            >
              <div className="w-body" inert={editing}>
                {def.body(range)}
              </div>
              {editing && (
                <div className="w-tools">
                  <button type="button" className="w-tool w-handle" aria-label={`Move ${def.title}, position ${i + 1} of ${layout.length}. Use the arrow keys.`} onKeyDown={(e) => nudge(e, i)}>
                    <Icon name="grip" size={15} />
                  </button>
                  {def.sizes.length > 1 && (
                    <button type="button" className="w-tool w-size" aria-label={`Width of ${def.title}: ${w.size} of 4 columns. Change`} onClick={() => resize(w)}>
                      {w.size}/4
                    </button>
                  )}
                  <button type="button" className="w-tool w-remove" aria-label={`Remove ${def.title}`} onClick={() => remove(w.id)}>
                    <Icon name="close" size={14} />
                  </button>
                </div>
              )}
            </article>
          )
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        {note}
      </p>
    </>
  )
}

/* ---------------- Messages ---------------- */

const now = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

function Messages() {
  const [active, setActive] = useState(chats[0].id)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [query, setQuery] = useState('')
  const [unread, setUnread] = useState(() => Object.fromEntries(chats.map((c) => [c.id, c.id === chats[0].id ? 0 : c.unread])))
  const [threads, setThreads] = useState<Record<string, Message[]>>(() =>
    Object.fromEntries(chats.map((c) => [c.id, c.id === 'baraka' ? firstMessages : [{ id: 1, me: false, text: c.last, time: c.when }]])),
  )
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const body = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const chat = chats.find((c) => c.id === active)!
  const list = chats.filter(
    (c) => (filter === 'all' || unread[c.id] > 0) && `${c.name} ${c.company}`.toLowerCase().includes(query.toLowerCase()),
  )

  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    body.current?.scrollTo({ top: body.current.scrollHeight, behavior: 'smooth' })
  }, [threads, typing, active])

  function open(id: string) {
    setActive(id)
    setUnread((u) => ({ ...u, [id]: 0 }))
    setTyping(false)
    window.clearTimeout(timer.current)
  }

  function send(text: string) {
    const t = text.trim()
    if (!t) return
    const id = active
    setThreads((th) => ({ ...th, [id]: [...th[id], { id: Date.now(), me: true, text: t, time: now() }] }))
    setDraft('')
    setTyping(true)
    window.clearTimeout(timer.current)
    // Fake reply, so the typing indicator and incoming animation can be seen.
    timer.current = window.setTimeout(() => {
      setTyping(false)
      const reply = replies[Math.floor(Math.random() * replies.length)]
      setThreads((th) => ({ ...th, [id]: [...th[id], { id: Date.now(), me: false, text: reply, time: now() }] }))
    }, 1600)
  }

  return (
    <>
      <header className="page-head rise" style={vars({ '--i': 0 })}>
        <div>
          <h1>Messages</h1>
          <p>Chat with clients and the team</p>
        </div>
        <button type="button" className="pill-btn">
          <Icon name="plus" size={16} /> New chat
        </button>
      </header>
      <div className="chat-grid">
        <aside className="glass chat-list rise" style={vars({ '--i': 1 })}>
          <label className="search-box">
            <Icon name="search" size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search clients" aria-label="Search chats" />
          </label>
          <Segmented
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all', label: 'All' },
              { id: 'unread', label: 'Unread' },
            ]}
          />
          <ul>
            {list.map((c) => (
              <li key={c.id}>
                <button type="button" className="chat-item" data-active={c.id === active} onClick={() => open(c.id)}>
                  <Avatar name={c.name} size={38} online={c.online} />
                  <span className="chat-text">
                    <strong>{c.name}</strong>
                    <small>{threads[c.id].at(-1)!.text}</small>
                  </span>
                  <span className="chat-meta">
                    <small>{c.when}</small>
                    {unread[c.id] > 0 && <b aria-label={`${unread[c.id]} unread`}>{unread[c.id]}</b>}
                  </span>
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="empty-note">No chats match. Clear the search to see all.</li>}
          </ul>
        </aside>

        <section className="glass chat rise" style={vars({ '--i': 2 })} aria-label={`Chat with ${chat.name}`}>
          <header className="chat-head">
            <Avatar name={chat.name} size={40} online={chat.online} />
            <div>
              <strong>{chat.name}</strong>
              <small>
                {chat.company} · {chat.online ? 'Online' : 'Offline'}
              </small>
            </div>
            <div className="chat-actions">
              <button type="button" className="icon-btn" aria-label="Call">
                <Icon name="phone" size={16} />
              </button>
              <button type="button" className="icon-btn" aria-label="Video call">
                <Icon name="video" size={16} />
              </button>
              <button type="button" className="icon-btn" aria-label="More">
                <Icon name="more" size={16} />
              </button>
            </div>
          </header>
          <div className="chat-body" ref={body} aria-live="polite">
            <span className="day">Today</span>
            {threads[active].map((m) => (
              <div key={m.id} className={`msg ${m.me ? 'me' : ''}`}>
                {!m.me && <Avatar name={chat.name} size={26} />}
                <p>
                  {m.text}
                  <time>{m.time}</time>
                </p>
              </div>
            ))}
            {typing && (
              <div className="msg">
                <Avatar name={chat.name} size={26} />
                <p className="typing" aria-label={`${chat.name} is typing`}>
                  <i />
                  <i />
                  <i />
                </p>
              </div>
            )}
          </div>
          <div className="suggest">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
          <form
            className="composer"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              send(draft)
            }}
          >
            <button type="button" className="icon-btn ghost" aria-label="Attach a file">
              <Icon name="clip" size={17} />
            </button>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Message ${chat.name.split(' ')[0]}`} aria-label="Message" />
            <button type="submit" className="send" aria-label="Send" disabled={!draft.trim()}>
              <Icon name="send" size={17} />
            </button>
          </form>
        </section>

        <aside className="glass profile rise" style={vars({ '--i': 3 })} key={chat.id}>
          <Avatar name={chat.name} size={84} online={chat.online} />
          <strong className="profile-name">{chat.name}</strong>
          <small>{chat.company}</small>
          <span className={`chip ${chat.online ? 'up' : ''}`}>{chat.online ? 'Online' : 'Offline'}</span>
          <div className="profile-actions">
            <button type="button" className="pill-btn small">
              <Icon name="mail" size={15} /> Email
            </button>
            <button type="button" className="pill-btn small">
              <Icon name="phone" size={15} /> Call
            </button>
          </div>
          <dl className="details">
            <div>
              <dt>Phone</dt>
              <dd>+998 90 123-45-67</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd>Chilonzor 9, Tashkent</dd>
            </div>
            <div>
              <dt>Owes</dt>
              <dd>31.2M soʻm, 12 days</dd>
            </div>
          </dl>
          <h3>Open orders</h3>
          <ul className="files">
            <li>
              <Icon name="box" size={16} /> SO-1042 <small>51.8M soʻm</small>
            </li>
            <li>
              <Icon name="receipt" size={16} /> INV-0877 <small>31.2M soʻm</small>
            </li>
          </ul>
        </aside>
      </div>
    </>
  )
}

/* ---------------- Saved ---------------- */

function SavedPage() {
  const [filter, setFilter] = useState<'All' | Saved['kind']>('All')
  const [items, setItems] = useState(savedSeed)
  const [pinned, setPinned] = useState<number[]>([1, 4])
  const shown = items.filter((s) => filter === 'All' || s.kind === filter)
  function add() {
    const id = Date.now()
    setItems((all) => [{ id, kind: 'Links', icon: 'external', tone: 'green', title: 'New link', text: 'Rename it and paste the address.', source: 'You', date: 'Now' }, ...all])
    setFilter('All')
  }
  return (
    <>
      <header className="page-head rise" style={vars({ '--i': 0 })}>
        <div>
          <h1>Saved</h1>
          <p>Reports, views and links you come back to</p>
        </div>
        <div className="head-actions">
          <Segmented
            label="Filter"
            value={filter}
            onChange={setFilter}
            options={(['All', 'Reports', 'Views', 'Links'] as const).map((k) => ({ id: k, label: k }))}
          />
          <button type="button" className="pill-btn primary" onClick={add}>
            <Icon name="plus" size={16} /> Add link
          </button>
        </div>
      </header>
      <div className="saved-grid" key={filter}>
        {shown.map((s, n) => (
          <article key={s.id} className="glass saved rise" style={vars({ '--i': n + 1 })}>
            <div className={`saved-art tone-${s.tone}`}>
              <Icon name={s.icon} size={22} />
              <span>{s.kind}</span>
            </div>
            <h2>{s.title}</h2>
            <p>{s.text}</p>
            <footer>
              <small>
                {s.source} · {s.date}
              </small>
              <button type="button" className="icon-btn ghost" aria-label={`Open ${s.title}`}>
                <Icon name="external" size={15} />
              </button>
              <button
                type="button"
                className="icon-btn ghost"
                aria-pressed={pinned.includes(s.id)}
                aria-label={`Pin ${s.title}`}
                onClick={() => setPinned((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))}
              >
                <Icon name="bookmark" size={15} />
              </button>
            </footer>
          </article>
        ))}
      </div>
    </>
  )
}

function NotBuilt({ page, go }: { page: Page; go: (p: Page) => void }) {
  return (
    <div className="glass not-built rise" style={vars({ '--i': 0 })}>
      <Icon name={ICONS[page]} size={28} />
      <h1>{NAMES[page]} isn't in this prototype</h1>
      <p>Home, Messages and Saved are. Open one of them to see the layout and motion.</p>
      <button type="button" className="pill-btn primary" onClick={() => go('home')}>
        Go to Home
      </button>
    </div>
  )
}

/* ---------------- Shell ---------------- */

// The logged-in person; the prototype's fake data stays everywhere else.
type User = { name: string; company_name: string; phone: string | null; email: string | null; username: string | null }

export default function Spatial({ look = 'glass', user, logoutLabel = 'Log out', onLogout }: { look?: Look; user?: User; logoutLabel?: string; onLogout?: () => void }) {
  // The page lives in the address (/#/messages), so a reload or shared link opens the same page.
  const [page, setPageState] = useState<Page>(() => {
    const p = window.location.hash.split('/')[1] as Page
    return p in NAMES ? p : 'home'
  })
  function setPage(p: Page) {
    window.history.replaceState(null, '', `#${lookPrefix(look)}/${p}`)
    setPageState(p)
  }
  // Popups render in <body>, outside .sp, so the look goes on <html> too.
  useEffect(() => {
    document.documentElement.dataset.look = look
  }, [look])
  const root = useRef<HTMLDivElement>(null)
  const [topRef, topInd] = useIndicator(page)

  // Background drifts a few pixels with the pointer, for depth. Skipped with reduced motion in CSS.
  function parallax(e: React.PointerEvent) {
    const r = root.current
    if (!r) return
    r.style.setProperty('--px', `${(e.clientX / window.innerWidth - 0.5) * -14}px`)
    r.style.setProperty('--py', `${(e.clientY / window.innerHeight - 0.5) * -10}px`)
  }

  return (
    <div className="sp" data-look={look} ref={root} onPointerMove={parallax}>
      {/* Glass draws a scene under its photo as a fallback; Light falls back to a plain color.
          The Plain looks have no wallpaper at all. */}
      {look === 'glass' && <Scene />}
      {(look === 'glass' || look === 'light') && <div className="sp-photo" aria-hidden="true" />}
      {look === 'glass' && <div className="sp-shade" aria-hidden="true" />}

      <header className="sp-topbar">
        {/* Empty: the sidebar carries the logo now. Keeps the nav centred. */}
        <div className="top-left" />
        <nav className="top-nav" ref={topRef} aria-label="Sections">
          <span className="nav-ind" style={topInd} aria-hidden="true" />
          {TOP.map((t) => (
            <button key={t.id} type="button" data-active={t.id === page} aria-current={t.id === page ? 'page' : undefined} onClick={() => setPage(t.id)}>
              <Icon name={t.icon} size={16} /> {t.label}
            </button>
          ))}
        </nav>
        <div className="top-right">
          <button type="button" className="icon-btn" aria-label="Messages" onClick={() => setPage('messages')}>
            <Icon name="mail" size={17} />
          </button>
          <button type="button" className="icon-btn" aria-label="Notifications, 3 new">
            <Icon name="bell" size={17} />
            <b className="badge">3</b>
          </button>
          <button type="button" className="icon-btn" aria-label="Search">
            <Icon name="search" size={17} />
          </button>
          <Avatar name={user?.name ?? 'Rustam Saidov'} size={38} online />
          {onLogout && (
            <button type="button" className="icon-btn" aria-label={logoutLabel} title={logoutLabel} onClick={onLogout}>
              <LogOut size={17} />
            </button>
          )}
        </div>
      </header>

      <Sidebar
        active={page}
        onNavigate={(id) => setPage(id as Page)}
        look={look}
        user={user && { name: user.name, detail: user.company_name }}
        // Switching looks changes the address; App passes the new look in without remounting.
        onLook={(l) => (window.location.hash = `#${lookPrefix(l)}/${page}`)}
      />

      <main className="sp-main" key={page}>
        {page === 'home' && <Home />}
        {page === 'messages' && <Messages />}
        {page === 'saved' && <SavedPage />}
        {page === 'components' && <Kit look={look} />}
        {!['home', 'messages', 'saved', 'components'].includes(page) && <NotBuilt page={page} go={setPage} />}
      </main>
    </div>
  )
}
