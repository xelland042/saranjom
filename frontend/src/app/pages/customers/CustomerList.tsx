// The customers list: search (any script, ИНН or phone), active or archived, what each owes and
// when they last bought, sortable, 50 at a time, and an Excel file. Filters live in the address.
import { useState, type CSSProperties } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { Archive, FileUp, Plus, Search, SearchX, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { customerList } from '../../customers'
import ImportDialog from '../../ImportDialog'
import { formatDay, localDate } from '../../dates'
import { ExportButton, SortHeader } from '../../ListTools'
import { formatMoney } from '../../money'
import { EmptyState, PageHeader } from '../../Page'
import { usePrefs } from '../../prefs'
import StatStrip from '../../StatStrip'
import { useOverview } from '../../useOverview'
import { useSearchBox } from '../../useSearchBox'
import CustomerForm from './CustomerForm'
import { useCan } from '../../session'

const route = getRouteApi('/app/customers')

const tile = (Icon: typeof Users, color: string) => (
  <span className="tile" style={{ '--c': color, '--t': '52px' } as CSSProperties} aria-hidden="true">
    <Icon className="size-6" />
  </span>
)

export default function CustomerList() {
  const { t, lang } = usePrefs()
  const { q = '', archived = false, sort = 'name' } = route.useSearch()
  const navigate = route.useNavigate()
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [text, onType] = useSearchBox(q, (v) => navigate({ search: (s) => ({ ...s, q: v }), replace: true }))

  const list = useInfiniteQuery(customerList(q, archived, sort))
  const { d, today, debt } = useOverview()
  const head = (label: string, field: string, extra?: { className?: string; descFirst?: boolean }) => (
    <SortHeader label={label} field={field} sort={sort} onSort={(s) => navigate({ search: (x) => ({ ...x, sort: s === 'name' ? undefined : s }), replace: true })} {...extra} />
  )
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const total = list.data?.pages[0]?.total ?? 0
  const can = useCan()
  const addButton = can('customers.write') && (
    <Button onClick={() => setAdding(true)}>
      <Plus aria-hidden="true" /> {t('addCustomer')}
    </Button>
  )

  let body
  if (list.isPending) {
    body = (
      <div className="grid gap-3 p-4" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 rounded-xl" />
        ))}
      </div>
    )
  } else if (list.isError) {
    body = (
      <div className="grid justify-items-center gap-3 px-6 py-14 text-center">
        <p>{t('offline')}</p>
        <Button variant="secondary" onClick={() => list.refetch()}>
          {t('retry')}
        </Button>
      </div>
    )
  } else if (rows.length === 0) {
    body = q ? (
      <EmptyState bare icon={tile(SearchX, 'var(--violet)')} title={t('nothingFound')} text={t('nothingFoundText')} />
    ) : archived ? (
      <EmptyState bare icon={tile(Archive, 'var(--violet)')} title={t('noArchived')} text={t('noArchivedText')} />
    ) : (
      <EmptyState bare icon={tile(Users, 'var(--accent)')} title={t('noCustomers')} text={t('noCustomersText')} action={addButton || undefined} />
    )
  } else {
    body = (
      <>
        <table className="w-full table-fixed text-sm" data-stale={list.isPlaceholderData || undefined}>
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-(--line)">
              {head(t('colName'), 'name')}
              <th scope="col" className="hidden w-36 px-4 py-3 font-medium lg:table-cell">{t('inn')}</th>
              <th scope="col" className="hidden w-44 px-4 py-3 font-medium md:table-cell">{t('phone')}</th>
              <th scope="col" className="w-44 px-4 py-3 text-right font-medium">{t('debt')}</th>
              {head(t('lastOrder'), 'last_order', { className: 'hidden w-44 sm:table-cell', descFirst: true })}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="relative border-b border-(--line) transition-colors last:border-0 hover:bg-(--soft)">
                <td className="px-4 py-3">
                  {/* the link covers the whole row, so any part of it opens the customer */}
                  <Link
                    to="/customers/$customerId"
                    params={{ customerId: String(c.id) }}
                    className="block truncate font-medium after:absolute after:inset-0 focus-visible:outline-none after:focus-visible:rounded-lg after:focus-visible:outline-2 after:focus-visible:outline-(--accent)"
                  >
                    {c.name}
                  </Link>
                  {/* on phones the other columns are hidden: show the phone under the name */}
                  {c.phone && <span className="block truncate text-xs text-muted-foreground md:hidden">{c.phone}</span>}
                </td>
                <td className="hidden px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums lg:table-cell">{c.inn ?? '—'}</td>
                <td className="hidden px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums md:table-cell">{c.phone ?? '—'}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {c.balances.length === 0
                    ? '—'
                    : c.balances.map((b) => (
                        <span key={b.currency} className={`block ${Number(b.overdue) > 0 ? 'text-red' : Number(b.balance) < 0 ? 'text-muted-foreground' : ''}`}>
                          {formatMoney(b.balance, b.currency, lang)}
                        </span>
                      ))}
                </td>
                <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                  {c.last_order ? (c.last_order === today ? t('today') : formatDay(localDate(c.last_order), lang)) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--line) px-4 py-3 text-xs text-muted-foreground">
          <span aria-live="polite">
            {t('shown')}: {rows.length} {t('of')} {total}
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
      <PageHeader
        title={t('customers')}
        description={t('customersIntro')}
        actions={
          <>
            {can('customers.write') && (
              <Button variant="outline" onClick={() => setImporting(true)}>
                <FileUp aria-hidden="true" /> {t('importButton')}
              </Button>
            )}
            <ExportButton path="/customers/export" params={{ q, archived, sort }} />
            {addButton}
          </>
        }
      />

      {/* the overview (and so the strip with its money) comes only with the dashboard permission */}
      {!archived && d && (
        <StatStrip
          stats={[
            { label: t('customers'), value: list.data?.pages[0]?.total ?? '…' },
            { label: t('totalOwed'), value: debt ? formatMoney(debt.owed, debt.currency, lang) : '0', link: { to: '/debts' } },
            {
              label: t('lateCustomers'),
              value: d?.debts.overdue_customers ?? '…',
              tone: d?.debts.overdue_customers ? 'red' : undefined,
              link: { to: '/debts', search: { overdue: true } },
            },
          ]}
        />
      )}
      <div className="rise mb-4 flex flex-wrap items-center gap-3" style={{ '--i': 1 } as CSSProperties}>
        <div className="relative min-w-0 flex-1 basis-64">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={text}
            onChange={(e) => onType(e.target.value)}
            placeholder={t('searchShort')}
            aria-label={t('searchCustomers')}
            className="pl-10"
          />
        </div>
        <Tabs value={archived ? 'archived' : 'active'} onValueChange={(v) => navigate({ search: (s) => ({ ...s, archived: v === 'archived' ? true : undefined }) })}>
          <TabsList>
            <TabsTrigger value="active">{t('activeTab')}</TabsTrigger>
            <TabsTrigger value="archived">{t('archivedTab')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <section className="glass rise overflow-hidden" style={{ '--i': 2 } as CSSProperties} aria-label={t('customers')}>
        {body}
      </section>

      <CustomerForm open={adding} onOpenChange={setAdding} />

      <ImportDialog kind="customers" open={importing} onOpenChange={setImporting} />
    </>
  )
}

