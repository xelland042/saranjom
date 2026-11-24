// Product categories: add, rename, delete (its products stay, without a category).
import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ApiError } from '../../api'
import { usePrefs } from '../../prefs'
import { categoriesQuery, useProductMutations, type Category } from '../../products'
import RenameRow from './RenameRow'

export default function CategoriesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = usePrefs()
  const categories = useQuery({ ...categoriesQuery, enabled: open })
  const { saveCategory, deleteCategory } = useProductMutations()
  const [renaming, setRenaming] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<Category | null>(null)
  const [name, setName] = useState('')

  const onError = (err: unknown) => toast.error(t(err instanceof ApiError && err.status === 409 ? 'nameTaken' : 'notSaved'))

  function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    saveCategory.mutate({ name: name.trim() }, { onError, onSuccess: () => setName('') })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('categories')}</DialogTitle>
          <DialogDescription className="sr-only">{t('noCategories')}</DialogDescription>
        </DialogHeader>

        {categories.data?.length === 0 && <p className="text-sm text-muted-foreground">{t('noCategories')}</p>}
        <ul className="grid">
          {categories.data?.map((c) => (
            <li key={c.id} className="flex min-h-12 items-center gap-3 border-b border-(--line) py-2 last:border-0">
              {renaming === c.id ? (
                <RenameRow
                  initial={c.name}
                  busy={saveCategory.isPending}
                  onSave={(n) => saveCategory.mutate({ id: c.id, name: n }, { onError, onSuccess: () => setRenaming(null) })}
                  onCancel={() => setRenaming(null)}
                />
              ) : deleting?.id === c.id ? (
                <div role="alert" className="flex flex-1 flex-wrap items-center gap-2">
                  <span className="grid min-w-0 flex-1 basis-40">
                    <strong className="truncate">{t('deleteCategoryQ')}</strong>
                    <small className="text-muted-foreground">{t('deleteCategoryText')}</small>
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={deleteCategory.isPending}
                    onClick={() => deleteCategory.mutate(c.id, { onError, onSuccess: () => setDeleting(null) })}
                  >
                    {t('delete')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>
                    {t('cancel')}
                  </Button>
                </div>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                  <span className="text-sm whitespace-nowrap text-muted-foreground">
                    {t('productsN')}: {c.products}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label={`${t('actions')}: ${c.name}`}>
                        <MoreHorizontal aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setRenaming(c.id)}>
                        <Pencil aria-hidden="true" /> {t('rename')}
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(c)}>
                        <Trash2 aria-hidden="true" /> {t('delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </li>
          ))}
        </ul>

        <form onSubmit={add} className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('newCategory')} aria-label={t('newCategory')} maxLength={200} />
          <Button type="submit" variant="secondary" disabled={saveCategory.isPending || !name.trim()}>
            {t('add')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
