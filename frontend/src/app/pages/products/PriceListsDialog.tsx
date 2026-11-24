// The company's price lists ("Ulgurji" in USD, "Chakana" in soʻm): add, rename, make one the
// default, archive. The currency is chosen once, because the prices in a list are in it.
import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Star } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ApiError } from '../../api'
import { CURRENCIES, currencyLabel } from '../../money'
import { usePrefs } from '../../prefs'
import { priceListsQuery, useProductMutations, type PriceList } from '../../products'
import RatesSection from './RatesSection'
import RenameRow from './RenameRow'

export default function PriceListsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, lang } = usePrefs()
  const lists = useQuery({ ...priceListsQuery, enabled: open })
  const { savePriceList } = useProductMutations()
  const [renaming, setRenaming] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('UZS')

  const onError = (err: unknown) => toast.error(t(err instanceof ApiError && err.status === 409 ? 'nameTaken' : 'notSaved'))
  const change = (l: PriceList, patch: { name?: string; is_default?: true; archived?: boolean }) =>
    savePriceList.mutate({ id: l.id, ...patch }, { onError, onSuccess: () => setRenaming(null) })

  function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    savePriceList.mutate(
      { name: name.trim(), currency },
      {
        onError,
        onSuccess: () => {
          setName('')
          toast.success(t('saved'))
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('priceLists')}</DialogTitle>
          <DialogDescription>{t('priceListsIntro')}</DialogDescription>
        </DialogHeader>

        <ul className="grid">
          {lists.data?.map((l) => (
            <li key={l.id} className="flex min-h-12 items-center gap-3 border-b border-(--line) py-2 last:border-0" data-archived={l.archived || undefined}>
              {renaming === l.id ? (
                <RenameRow initial={l.name} busy={savePriceList.isPending} onSave={(n) => change(l, { name: n })} onCancel={() => setRenaming(null)} />
              ) : (
                <>
                  <span className={`min-w-0 flex-1 truncate font-medium ${l.archived ? 'text-muted-foreground line-through' : ''}`}>{l.name}</span>
                  {l.is_default && <Badge>{t('defaultBadge')}</Badge>}
                  {l.archived && <Badge variant="secondary">{t('archived')}</Badge>}
                  <span className="w-12 text-right text-sm text-muted-foreground">{currencyLabel(l.currency, lang)}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label={`${t('actions')}: ${l.name}`}>
                        <MoreHorizontal aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setRenaming(l.id)}>
                        <Pencil aria-hidden="true" /> {t('rename')}
                      </DropdownMenuItem>
                      {!l.is_default && !l.archived && (
                        <DropdownMenuItem onSelect={() => change(l, { is_default: true })}>
                          <Star aria-hidden="true" /> {t('makeDefault')}
                        </DropdownMenuItem>
                      )}
                      {!l.is_default && (
                        <DropdownMenuItem onSelect={() => change(l, { archived: !l.archived })}>
                          {l.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                          {t(l.archived ? 'restore' : 'archive')}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </li>
          ))}
        </ul>

        <form onSubmit={add} className="grid gap-2 rounded-2xl bg-(--soft) p-3">
          <p className="text-sm font-medium">{t('newPriceList')}</p>
          <div className="flex flex-wrap gap-2">
            <Label htmlFor="price-list-name" className="sr-only">{t('priceListName')}</Label>
            <Input id="price-list-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('priceListName')} maxLength={200} className="min-w-0 flex-1 basis-48" />
            <Label htmlFor="price-list-currency" className="sr-only">{t('currency')}</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="price-list-currency" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>{c === 'UZS' ? `UZS · ${currencyLabel(c, lang)}` : c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" variant="secondary" disabled={savePriceList.isPending || !name.trim()}>
              {t('add')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('currencyFixed')}</p>
        </form>

        <RatesSection enabled={open} />
      </DialogContent>
    </Dialog>
  )
}
