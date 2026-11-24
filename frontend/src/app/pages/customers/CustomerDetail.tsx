// One customer: its details, actions (edit, archive) and the people to call there.
import { useState, type CSSProperties, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { Archive, ArchiveRestore, ArrowLeft, MoreHorizontal, Pencil, Phone, Plus, Trash2, UserRound, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '../../api'
import { customerQuery, useCustomerMutations, type Contact, type Customer } from '../../customers'
import { formatDay } from '../../dates'
import { currencyLabel, formatMoney } from '../../money'
import { EmptyState, PageHeader } from '../../Page'
import { usePrefs } from '../../prefs'
import { priceListsQuery } from '../../products'
import { ContactForm, DeleteContact } from './ContactForm'
import BalanceSection from '../debts/BalanceSection'
import CustomerTasks from '../tasks/CustomerTasks'
import CustomerActivity from './CustomerActivity'
import CustomerForm from './CustomerForm'
import { useCan } from '../../session'

const route = getRouteApi('/app/customers/$customerId')

const tile = (Icon: typeof UserX, color: string, size = 52) => (
  <span className="tile" style={{ '--c': color, '--t': `${size}px` } as CSSProperties} aria-hidden="true">
    <Icon className={size > 40 ? 'size-6' : 'size-4'} />
  </span>
)

export default function CustomerDetail() {
  const { t } = usePrefs()
  const { customerId } = route.useParams()
  const query = useQuery(customerQuery(Number(customerId)))

  const back = (
    <Link to="/customers" className="rise mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-(--text)">
      <ArrowLeft className="size-4" aria-hidden="true" /> {t('backToCustomers')}
    </Link>
  )

  if (query.isPending) {
    return (
      <div aria-busy="true">
        {back}
        <Skeleton className="mb-6 h-9 w-72 rounded-xl" />
        <Skeleton className="h-64 rounded-(--radius)" />
      </div>
    )
  }
  if (query.isError) {
    const missing = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 422)
    return (
      <>
        {back}
        <EmptyState
          icon={tile(UserX, 'var(--violet)')}
          title={t(missing ? 'customerNotFound' : 'offline')}
          text={missing ? t('customerNotFoundText') : ''}
          action={
            !missing && (
              <Button variant="secondary" onClick={() => query.refetch()}>
                {t('retry')}
              </Button>
            )
          }
        />
      </>
    )
  }
  return (
    <>
      {back}
      <Loaded customer={query.data} />
    </>
  )
}

function Loaded({ customer: c }: { customer: Customer }) {
  const { t, lang } = usePrefs()
  const { update } = useCustomerMutations()
  const can = useCan()
  const lists = useQuery(priceListsQuery)
  const priceList = lists.data?.find((l) => (c.price_list_id ? l.id === c.price_list_id : l.is_default))
  const priceListName = priceList && `${priceList.name} · ${currencyLabel(priceList.currency, lang)}${c.price_list_id ? '' : ` (${t('byDefault')})`}`
  const [editing, setEditing] = useState(false)
  // closing keeps the contact, so the dialog's text doesn't change while it fades out
  const [contactForm, setContactForm] = useState<{ open: boolean; contact?: Contact }>({ open: false })
  const [deleting, setDeleting] = useState<{ open: boolean; contact?: Contact }>({ open: false })

  const setArchived = (archived: boolean, undoable = true) =>
    update.mutate(
      { id: c.id, archived },
      {
        onSuccess: () =>
          toast.success(t(archived ? 'archivedToast' : 'restoredToast'), {
            action: undoable ? { label: t('undo'), onClick: () => setArchived(!archived, false) } : undefined,
          }),
        onError: () => toast.error(t('notSaved')),
      },
    )

  const row = (label: string, value: ReactNode) => (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value || '—'}</dd>
    </div>
  )

  return (
    <>
      <PageHeader
        title={<span className="break-words">{c.name}</span>}
        description={c.archived && <Badge variant="secondary">{t('archived')}</Badge>}
        actions={
          <>
            {can('customers.write') && (
              <>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden="true" /> {t('edit')}
                </Button>
                <Button variant="ghost" disabled={update.isPending} onClick={() => setArchived(!c.archived)}>
                  {c.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                  {t(c.archived ? 'restore' : 'archive')}
                </Button>
              </>
            )}
          </>
        }
      />

      {can('money.read') && (
        <div className="mb-4">
          <BalanceSection customer={c} />
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="glass rise p-5" style={{ '--i': 2 } as CSSProperties} aria-label={t('history')}>
          <CustomerActivity customer={c} />
        </section>

        <div className="grid gap-4">
          <section className="glass rise p-5" style={{ '--i': 2 } as CSSProperties} aria-labelledby="customer-details">
            <h2 id="customer-details" className="mb-4 text-lg font-semibold">{t('details')}</h2>
            <dl className="grid gap-3">
              {row(t('inn'), c.inn && <span className="tabular-nums">{c.inn}</span>)}
              {row(t('phone'), c.phone && <a href={`tel:${c.phone}`} className="tabular-nums hover:underline">{c.phone}</a>)}
              {row(t('address'), c.address)}
              {row(t('priceList'), priceListName)}
              {row(t('paymentDays'), c.payment_days ? `${c.payment_days} ${t('daysShort')}` : t('onTheDay'))}
              {c.credit_limit && row(t('creditLimit'), <span className="tabular-nums">{formatMoney(c.credit_limit, c.credit_currency ?? 'UZS', lang)}</span>)}
              {row(t('note'), c.note && <span className="whitespace-pre-line">{c.note}</span>)}
              {row(t('addedOn'), formatDay(new Date(c.created_at), lang))}
            </dl>
          </section>
          <section className="glass rise p-5" style={{ '--i': 3 } as CSSProperties} aria-labelledby="customer-contacts">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="customer-contacts" className="text-lg font-semibold">{t('contacts')}</h2>
              {c.contacts.length > 0 && can('customers.write') && (
                <Button size="sm" variant="secondary" onClick={() => setContactForm({ open: true })}>
                  <Plus aria-hidden="true" /> {t('addContact')}
                </Button>
              )}
            </div>
            {c.contacts.length === 0 ? (
              <div className="grid justify-items-center gap-2 py-6 text-center">
                {tile(UserRound, 'var(--accent)', 40)}
                <p className="font-medium">{t('noContacts')}</p>
                <p className="max-w-xs text-sm text-muted-foreground">{t('noContactsText')}</p>
                {can('customers.write') && (
                  <Button size="sm" variant="secondary" className="mt-1" onClick={() => setContactForm({ open: true })}>
                    <Plus aria-hidden="true" /> {t('addContact')}
                  </Button>
                )}
              </div>
            ) : (
              <ul className="grid">
                {c.contacts.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 border-b border-(--line) py-2.5 last:border-0">
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-medium">{p.name}</span>
                      {p.position && <span className="truncate text-xs text-muted-foreground">{p.position}</span>}
                    </span>
                    {p.phone && (
                      <a href={`tel:${p.phone}`} className="flex items-center gap-1.5 text-sm whitespace-nowrap tabular-nums text-muted-foreground hover:text-(--text)">
                        <Phone className="size-3.5" aria-hidden="true" />
                        {p.phone}
                      </a>
                    )}
                    {can('customers.write') && <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" aria-label={`${t('actions')}: ${p.name}`}>
                          <MoreHorizontal aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setContactForm({ open: true, contact: p })}>
                          <Pencil aria-hidden="true" /> {t('edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting({ open: true, contact: p })}>
                          <Trash2 aria-hidden="true" /> {t('delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {can('tasks') && <CustomerTasks customer={c} />}
        </div>
      </div>

      <CustomerForm open={editing} onOpenChange={setEditing} customer={c} />
      <ContactForm
        customerId={c.id}
        contact={contactForm.contact}
        open={contactForm.open}
        onOpenChange={(open) => setContactForm({ ...contactForm, open })}
      />
      <DeleteContact
        customerId={c.id}
        contact={deleting.contact}
        open={deleting.open}
        onOpenChange={(open) => setDeleting({ ...deleting, open })}
      />
    </>
  )
}
