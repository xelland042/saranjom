// A record's history or a customer's timeline: what happened, by whom, when, newest first and
// grouped by day; on a customer, notes too ("called, promises to pay on Friday"), which their
// author can delete. The rest of the history can't be changed.
import { useState, type FormEvent } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CheckSquare, History, Package, ShoppingCart, StickyNote, Trash2, Undo2, UserRound, Wallet, Warehouse } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { activityFeed, useNotes, type Activity, type Scope } from './activity'
import { daysSince, formatDay, isoToday, localDate } from './dates'
import { METHOD_LABEL, type Method } from './debts'
import type { Key } from './i18n'
import { formatDecimal, formatMoney } from './money'
import { usePrefs } from './prefs'
import { KIND_LABEL, type Kind } from './stock'

const ICON = { customer: UserRound, order: ShoppingCart, payment: Wallet, task: CheckSquare, product: Package, stock_document: Warehouse, return: Undo2 }
const COLOR = { customer: 'var(--accent)', order: 'var(--green)', payment: 'var(--gold)', task: 'var(--blue)', product: 'var(--violet)', stock_document: 'var(--amber)', return: 'var(--green)' }
// field names in a change, as the forms call them
const FIELD: Record<string, Key> = {
  name: 'colName',
  inn: 'inn',
  phone: 'phone',
  address: 'address',
  note: 'note',
  price_list_id: 'priceList',
  payment_days: 'paymentDays',
  credit_limit: 'creditLimit',
  credit_currency: 'currency',
  sku: 'sku',
  barcode: 'barcode',
  unit: 'unit',
  category_id: 'category',
  mxik: 'mxik',
  min_stock: 'minStock',
  cost: 'costShort',
  prices: 'prices',
}
// changes shown with their values; the others (ids, prices) by name only
const SHOWN = new Set(['name', 'inn', 'phone', 'address', 'sku', 'barcode', 'mxik', 'payment_days', 'min_stock'])

// "ev_order_confirmed" and the like; unknown actions fall back to a plain "changed"
const phraseKey = (a: Activity) => `ev_${a.entity}_${a.action}` as Key

export default function Timeline({ scope, notes = false, title }: { scope: Scope; notes?: boolean; title?: string }) {
  const { t, lang } = usePrefs()
  const feed = useInfiniteQuery(activityFeed(scope))
  const items = feed.data?.pages.flat() ?? []
  const today = isoToday()

  // group by local day: "Bugun", "Kecha", then dates
  const groups: { day: string; items: Activity[] }[] = []
  for (const a of items) {
    const d = new Date(a.created_at)
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] })
    groups.at(-1)!.items.push(a)
  }
  const dayLabel = (day: string) => (day === today ? t('today') : daysSince(day) === 1 ? t('yesterday') : formatDay(localDate(day), lang))

  return (
    <div className="grid gap-3">
      {title && <h2 className="text-lg font-semibold">{title}</h2>}
      {notes && 'customerId' in scope && <NoteBox customerId={scope.customerId} />}
      {feed.isPending ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : feed.isError ? (
        <p className="text-sm text-muted-foreground">{t('offline')}</p>
      ) : items.length === 0 ? (
        <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <History className="size-4" aria-hidden="true" /> {t('noHistory')}
        </p>
      ) : (
        <ol className="grid gap-4">
          {groups.map((g) => (
            <li key={g.day}>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{dayLabel(g.day)}</h3>
              <ol className="grid gap-3">
                {g.items.map((a) => (
                  <Event key={a.id} a={a} showRecord={'customerId' in scope} />
                ))}
              </ol>
            </li>
          ))}
        </ol>
      )}
      {feed.hasNextPage && (
        <Button size="sm" variant="secondary" className="justify-self-start" disabled={feed.isFetchingNextPage} onClick={() => feed.fetchNextPage()}>
          {t('showMore')}
        </Button>
      )}
    </div>
  )
}

function NoteBox({ customerId }: { customerId: number }) {
  const { t } = usePrefs()
  const { add } = useNotes(customerId)
  const [text, setText] = useState('')
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    add.mutate(text.trim(), { onSuccess: () => setText(''), onError: () => toast.error(t('notSaved')) })
  }
  return (
    <form onSubmit={submit} className="grid gap-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        // Ctrl+Enter saves, as in chat apps
        onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && submit(e)}
        maxLength={2000}
        rows={2}
        placeholder={t('notePlaceholder')}
        aria-label={t('addNote')}
      />
      {text.trim() && (
        <Button type="submit" size="sm" className="justify-self-end" disabled={add.isPending}>
          <StickyNote aria-hidden="true" /> {t('addNote')}
        </Button>
      )}
    </form>
  )
}

function Event({ a, showRecord }: { a: Activity; showRecord: boolean }) {
  const { t, lang } = usePrefs()
  const { remove } = useNotes(a.customer_id ?? 0)
  const Icon = a.action === 'note' ? StickyNote : ICON[a.entity]
  const time = new Date(a.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const d = a.data as Record<string, string | number | null | undefined>
  const money = (v: unknown, c: unknown) => formatMoney(String(v), String(c), lang)

  let detail: React.ReactNode = null
  if (a.entity === 'order' && showRecord) {
    detail = (
      <>
        <Link to="/orders/$orderId" params={{ orderId: String(a.entity_id) }} className="font-medium hover:underline">
          № {d.number}
        </Link>{' '}
        · {money(d.total, d.currency)}
      </>
    )
  } else if (a.entity === 'order') {
    detail = d.total !== undefined && money(d.total, d.currency)
  } else if (a.entity === 'return') {
    detail = (
      <>
        <Link to="/returns/$returnId" params={{ returnId: String(a.entity_id) }} className="font-medium hover:underline">
          № {d.number}
        </Link>{' '}
        · {money(d.total, d.currency)} · {t('order')} № {d.order_number}
      </>
    )
  } else if (a.entity === 'payment') {
    detail = `№ ${d.number} · ${money(d.amount, d.currency)} · ${t(METHOD_LABEL[d.method as Method] ?? 'methodCash')}`
  } else if (a.entity === 'task') {
    // a move says where to: the column's name as it was then
    detail = `${d.title}${d.stage ? ` → ${d.stage}` : d.due_date ? ` · ${formatDay(localDate(String(d.due_date)), lang)}` : ''}`
  } else if (a.entity === 'stock_document') {
    detail = (
      <Link to="/stock/documents/$documentId" params={{ documentId: String(a.entity_id) }} className="hover:underline">
        {t(KIND_LABEL[d.kind as Kind])} № {d.number}
      </Link>
    )
  } else if (a.action === 'opening_set') {
    detail = `${money(String(d.amount).replace('-', ''), d.currency)}${String(d.amount).startsWith('-') ? ` (${t('paidAhead').toLowerCase()})` : ''}`
  } else if (a.action === 'contact_added' || a.action === 'contact_deleted') {
    detail = String(d.name)
  } else if (a.action === 'updated' && d.changes) {
    const changes = d.changes as unknown as Record<string, [unknown, unknown]>
    detail = Object.entries(changes)
      .map(([f, [from, to]]) => {
        const label = FIELD[f] ? t(FIELD[f]) : f
        if (!SHOWN.has(f)) return label
        const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : f === 'min_stock' ? formatDecimal(String(v)) : String(v))
        return `${label}: ${show(from)} → ${show(to)}`
      })
      .join('; ')
  } else if (a.entity === 'product' && a.action === 'created') {
    detail = String(d.name ?? '')
  }

  return (
    <li className="flex gap-3">
      <span className="tile mt-0.5 flex-none" style={{ '--c': a.action === 'note' ? 'var(--gold)' : COLOR[a.entity], '--t': '30px' } as React.CSSProperties} aria-hidden="true">
        <Icon className="size-3.5" />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5 text-sm">
        {a.action === 'note' ? (
          <p className="rounded-2xl bg-(--soft) px-3 py-2 break-words whitespace-pre-line">{a.text}</p>
        ) : (
          <p>
            <span className="font-medium">{t(phraseKey(a))}</span>
            {detail && <span className="text-muted-foreground"> · {detail}</span>}
          </p>
        )}
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">{time}</span>
          {a.user_name && <span>· {a.user_name}</span>}
          {a.action === 'note' && a.mine && (
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-red"
              disabled={remove.isPending}
              onClick={() => remove.mutate(a.id, { onError: () => toast.error(t('notSaved')) })}
            >
              <Trash2 className="size-3" aria-hidden="true" /> {t('delete')}
            </button>
          )}
        </p>
      </div>
    </li>
  )
}
