// The cash box and the bank: what is in each, and every movement of money in one list (customers'
// payments, payments to suppliers, expenses, other money in, transfers), newest first. Expenses,
// other money in and transfers are entered here; a wrong one is cancelled, never edited.
import { useState, type CSSProperties } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { ArrowLeftRight, Ban, Landmark, Minus, Plus, Search, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CATEGORY_LABEL, KIND_LABEL, MONEY_KINDS, moneyList, PLACE_LABEL, PLACES, useMoneyMutations, type Balance, type MoneyFilters, type MoneyKind, type MoneyRow, type Place } from '../../cash'
import { formatDay, localDate } from '../../dates'
import { DateRange, ExportButton } from '../../ListTools'
import { currencyLabel, formatMoney } from '../../money'
import { EmptyState } from '../../Page'
import { usePrefs } from '../../prefs'
import { useCan } from '../../session'
import { Tile } from '../stock/Balances'
import MoneyHeader from './MoneyHeader'
import MoveDialog, { type MoveStart } from './MoveDialog'

const route = getRouteApi('/app/cash')
const unsigned = (amount: string) => amount.replace('-', '')

export default function Cash() {
  const { t, lang } = usePrefs()
  const can = useCan()
  const { place, kind, from, to } = route.useSearch()
  const navigate = route.useNavigate()
  const set = (patch: Record<string, unknown>) => navigate({ search: (s) => ({ ...s, ...patch }), replace: true })
  const filters: MoneyFilters = { place, kind, date_from: from, date_to: to }
  const list = useInfiniteQuery(moneyList(filters))
  const first = list.data?.pages[0]
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  // closing keeps the kind, so the dialog's title doesn't change while it fades out
  const [adding, setAdding] = useState<{ open: boolean; start: MoveStart }>({ open: false, start: { kind: 'expense' } })
  const start = (s: MoveStart) => setAdding({ open: true, start: s })

  // the cash box and the bank in soʻm always show, even empty; other currencies when there is some
  const balances: Balance[] = first
    ? [...PLACES.filter((p) => !first.balances.some((b) => b.place === p && b.currency === 'UZS')).map((p) => ({ place: p, currency: 'UZS', amount: '0' })), ...first.balances].sort(
        (a, b) => PLACES.indexOf(a.place) - PLACES.indexOf(b.place) || Number(b.currency === 'UZS') - Number(a.currency === 'UZS') || a.currency.localeCompare(b.currency),
      )
    : []

  let body
  if (list.isPending) {
    body = (
      <div className="grid gap-3 p-4" aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 rounded-xl" />
        ))}
      </div>
    )
  } else if (list.isError) {
    body = (
      <div className="grid justify-items-center gap-3 px-6 py-14 text-center">
        <p>{t('offline')}</p>
        <Button variant="secondary" onClick={() => list.refetch()}>{t('retry')}</Button>
      </div>
    )
  } else if (rows.length === 0) {
    body =
      place || kind || from || to ? (
        <EmptyState bare icon={<Tile icon={Search} color="var(--violet)" />} title={t('nothingFound')} text="" />
      ) : (
        <EmptyState
          bare
          icon={<Tile icon={Wallet} color="var(--gold)" />}
          title={t('noMoney')}
          text={t('noMoneyText')}
          action={can('money.write') ? <Button onClick={() => start({ kind: 'income', category: 'opening' })}>{t('enterOpening')}</Button> : undefined}
        />
      )
  } else {
    body = (
      <>
        <ul data-stale={list.isPlaceholderData || undefined}>
          {rows.map((r) => (
            <Row key={`${r.source}-${r.id}-${r.amount.startsWith('-') ? 'out' : 'in'}`} row={r} />
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--line) px-5 py-3 text-xs text-muted-foreground">
          <span aria-live="polite">
            {t('shown')}: {rows.length} {t('of')} {first?.total ?? 0}
          </span>
          <span className="flex flex-wrap gap-x-4 tabular-nums">
            {first?.sums.map((s) => (
              <span key={s.currency}>
                {t('moneyIn')}: <strong className="text-(--text)">{formatMoney(s.incoming, s.currency, lang)}</strong> · {t('moneyOut')}:{' '}
                <strong className="text-(--text)">{formatMoney(s.outgoing, s.currency, lang)}</strong>
              </span>
            ))}
          </span>
          {list.hasNextPage && (
            <Button size="sm" variant="secondary" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
              {t('showMore')}
            </Button>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      <MoneyHeader />
      <div className="rise mb-4 grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]" style={{ '--i': 2 } as CSSProperties} aria-busy={list.isPending || undefined}>
        {balances.map((b) => (
          <section key={`${b.place}-${b.currency}`} className="glass flex items-center gap-3 p-4" aria-label={`${t(PLACE_LABEL[b.place])}, ${currencyLabel(b.currency, lang)}`}>
            <Tile icon={b.place === 'cash' ? Wallet : Landmark} color={b.place === 'cash' ? 'var(--gold)' : 'var(--accent)'} />
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">{t(PLACE_LABEL[b.place])}</p>
              <p className={`text-lg font-semibold tabular-nums ${Number(b.amount) < 0 ? 'text-red' : ''}`}>{formatMoney(b.amount, b.currency, lang)}</p>
            </div>
          </section>
        ))}
      </div>
      <div className="rise mb-4 flex flex-wrap items-center gap-3" style={{ '--i': 3 } as CSSProperties}>
        <Tabs value={place ?? 'all'} onValueChange={(v) => set({ place: v === 'all' ? undefined : v })}>
          <TabsList>
            <TabsTrigger value="all">{t('allPlaces')}</TabsTrigger>
            {PLACES.map((p) => (
              <TabsTrigger key={p} value={p}>{t(PLACE_LABEL[p])}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select value={kind ?? 'any'} onValueChange={(v) => set({ kind: v === 'any' ? undefined : (v as MoneyKind) })}>
          <SelectTrigger className="w-56" aria-label={t('anyKind')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t('anyKind')}</SelectItem>
            {MONEY_KINDS.map((k) => (
              <SelectItem key={k} value={k}>{t(KIND_LABEL[k])}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRange value={{ from, to }} onChange={(r) => set({ from: r.from, to: r.to })} />
        <ExportButton path="/money/export" params={filters} />
        {can('money.write') && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => start({ kind: 'transfer' })}>
              <ArrowLeftRight aria-hidden="true" /> {t('addTransfer')}
            </Button>
            <Button variant="outline" onClick={() => start({ kind: 'income' })}>
              <Plus aria-hidden="true" /> {t('addIncome')}
            </Button>
            <Button onClick={() => start({ kind: 'expense' })}>
              <Minus aria-hidden="true" /> {t('addExpense')}
            </Button>
          </div>
        )}
      </div>
      <section className="glass rise overflow-hidden" style={{ '--i': 4 } as CSSProperties} aria-label={t('cashTab')}>
        {body}
      </section>
      <MoveDialog open={adding.open} onOpenChange={(open) => setAdding({ ...adding, open })} start={adding.start} />
    </>
  )
}

// One line. A payment links to its customer or supplier, where it is cancelled; what was entered
// here has its own cancel, asked twice, since a cancelled one can't be brought back.
function Row({ row: r }: { row: MoneyRow }) {
  const { t, lang } = usePrefs()
  const can = useCan()
  const { cancel } = useMoneyMutations()
  const [asking, setAsking] = useState(false)
  const cancelled = !!r.cancelled_at
  const incoming = !r.amount.startsWith('-')
  const what = r.category
    ? t(CATEGORY_LABEL[r.category])
    : r.other_place
      ? `${incoming ? '←' : '→'} ${t(PLACE_LABEL[r.other_place as Place])}${r.other_currency !== r.currency ? ` (${currencyLabel(r.other_currency!, lang)})` : ''}`
      : null
  const title = `${t(KIND_LABEL[r.kind])} № ${r.number}`
  return (
    <li className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-(--line) px-5 py-3 text-sm last:border-0 ${cancelled ? 'text-muted-foreground' : ''}`}>
      <div className="min-w-0 flex-1 basis-56">
        <p className="truncate font-medium">
          {t(KIND_LABEL[r.kind])}
          {what && <span className="font-normal">: {what}</span>}
          {r.party && r.party_id && (
            <>
              {': '}
              {r.kind === 'payment' ? (
                <Link to="/customers/$customerId" params={{ customerId: String(r.party_id) }} className="font-normal underline-offset-4 hover:underline">{r.party}</Link>
              ) : (
                <Link to="/stock/suppliers/$supplierId" params={{ supplierId: String(r.party_id) }} className="font-normal underline-offset-4 hover:underline">{r.party}</Link>
              )}
            </>
          )}
          {cancelled && <Badge variant="secondary" className="ml-2">{t('cancelledBadge')}</Badge>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {formatDay(localDate(r.date), lang)} · {t(PLACE_LABEL[r.place])} · № {r.number}
          {r.note && ` · ${r.note}`}
        </p>
      </div>
      <span className={`whitespace-nowrap tabular-nums ${cancelled ? 'line-through' : incoming ? 'text-green' : ''}`}>
        {incoming ? '+' : '−'}
        {formatMoney(unsigned(r.amount), r.currency, lang)}
      </span>
      {/* the slot keeps the amounts in one column whether or not a line has a cancel button */}
      <span className="flex min-w-9 justify-end">
      {r.source === 'money_move' &&
        !cancelled &&
        can('money.write') &&
        (asking ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={cancel.isPending}
            onClick={() =>
              cancel.mutate(r.id, {
                onSuccess: () => toast.success(t('moveCancelled')),
                onError: () => toast.error(t('notSaved')),
              })
            }
          >
            {t('confirmCancelPayment')}
          </Button>
        ) : (
          <Button size="icon" variant="ghost" aria-label={`${t('cancelDoc')}: ${title}`} onClick={() => setAsking(true)}>
            <Ban aria-hidden="true" />
          </Button>
        ))}
      </span>
    </li>
  )
}
