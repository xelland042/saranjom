// The company's warehouses (a warehouse, a shop, a delivery van): add, rename, make one the
// default, archive. A warehouse with stock can't be archived until its goods are moved out.
import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Star } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ApiError, invalidFields } from '../../api'
import { usePrefs } from '../../prefs'
import { useStockMutations, warehousesQuery, type Warehouse } from '../../stock'
import RenameRow from '../products/RenameRow'

export default function WarehousesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = usePrefs()
  const warehouses = useQuery({ ...warehousesQuery, enabled: open })
  const { saveWarehouse } = useStockMutations()
  const [renaming, setRenaming] = useState<number | null>(null)
  const [name, setName] = useState('')

  const onError = (err: unknown) =>
    toast.error(
      t(
        err instanceof ApiError && err.status === 409
          ? 'nameTaken'
          : invalidFields(err).has('archived')
            ? 'warehouseHasStock'
            : 'notSaved',
      ),
    )
  const change = (w: Warehouse, patch: { name?: string; is_default?: true; archived?: boolean }) =>
    saveWarehouse.mutate({ id: w.id, ...patch }, { onError, onSuccess: () => setRenaming(null) })

  function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    saveWarehouse.mutate({ name: name.trim() }, { onError, onSuccess: () => setName('') })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('warehouses')}</DialogTitle>
          <DialogDescription className="sr-only">{t('stockIntro')}</DialogDescription>
        </DialogHeader>
        <ul className="grid">
          {warehouses.data?.map((w) => (
            <li key={w.id} className="flex min-h-12 items-center gap-3 border-b border-(--line) py-2 last:border-0">
              {renaming === w.id ? (
                <RenameRow initial={w.name} busy={saveWarehouse.isPending} onSave={(n) => change(w, { name: n })} onCancel={() => setRenaming(null)} />
              ) : (
                <>
                  <span className={`min-w-0 flex-1 truncate font-medium ${w.archived ? 'text-muted-foreground line-through' : ''}`}>{w.name}</span>
                  {w.is_default && <Badge>{t('defaultBadge')}</Badge>}
                  {w.archived && <Badge variant="secondary">{t('archived')}</Badge>}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label={`${t('actions')}: ${w.name}`}>
                        <MoreHorizontal aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setRenaming(w.id)}>
                        <Pencil aria-hidden="true" /> {t('rename')}
                      </DropdownMenuItem>
                      {!w.is_default && !w.archived && (
                        <DropdownMenuItem onSelect={() => change(w, { is_default: true })}>
                          <Star aria-hidden="true" /> {t('makeDefault')}
                        </DropdownMenuItem>
                      )}
                      {!w.is_default && (
                        <DropdownMenuItem onSelect={() => change(w, { archived: !w.archived })}>
                          {w.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                          {t(w.archived ? 'restore' : 'archive')}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('warehouseName')} aria-label={t('newWarehouse')} maxLength={200} />
          <Button type="submit" variant="secondary" disabled={saveWarehouse.isPending || !name.trim()}>
            {t('add')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
