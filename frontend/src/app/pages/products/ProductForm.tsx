// Add or edit a product in a dialog: what it is, how it's counted, and its price in each price list.
import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { AlertCircle, Archive, ArchiveRestore, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, invalidFields } from '../../api'
import Field from '../../Field'
import { currencyLabel, formatAmount, formatDecimal, parseAmount, parsePositive } from '../../money'
import { usePrefs } from '../../prefs'
import { categoriesQuery, priceListsQuery, ratesQuery, UNITS, useEquivalent, useProductMutations, type Product, type Unit } from '../../products'

type Props = { open: boolean; onOpenChange: (open: boolean) => void; product?: Product; showEquivalent?: boolean }

export default function ProductForm({ open, onOpenChange, product, showEquivalent = false }: Props) {
  const { t } = usePrefs()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t(product ? 'editProduct' : 'newProduct')}</DialogTitle>
          <DialogDescription className="sr-only">{t('productsIntro')}</DialogDescription>
        </DialogHeader>
        {/* mounted only while open, so every opening starts from the saved values */}
        <Body product={product} showEquivalent={showEquivalent} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ product, showEquivalent, close }: { product?: Product; showEquivalent: boolean; close: () => void }) {
  const { t, lang } = usePrefs()
  const navigate = useNavigate()
  const { save, saveCategory } = useProductMutations()
  const categories = useQuery(categoriesQuery)
  const lists = useQuery(priceListsQuery)
  const activeLists = (lists.data ?? []).filter((l) => !l.archived)
  const equivalent = useEquivalent()
  const base = useQuery(ratesQuery).data?.base // the company's currency: the cost is in it

  const [f, setF] = useState({
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    unit: (product?.unit ?? 'pcs') as Unit,
    category_id: product?.category_id ?? null,
    mxik: product?.mxik ?? '',
    note: product?.note ?? '',
  })
  // the reorder point, typed as text; empty means no alert
  const [minStock, setMinStock] = useState(product?.min_stock ? formatDecimal(product.min_stock) : '')
  const [cost, setCost] = useState(product?.cost ? formatAmount(product.cost) : '')
  // typed prices by price list, and which non-default lists have a row (the default always has one)
  const [prices, setPrices] = useState<Record<number, string>>(() =>
    Object.fromEntries((product?.prices ?? []).map((p) => [p.price_list_id, formatAmount(p.amount)])),
  )
  const [extra, setExtra] = useState<number[]>(() => (product?.prices ?? []).map((p) => p.price_list_id))
  const main = activeLists.find((l) => l.is_default)
  // rows in the order of the saved prices; lists since archived or made default drop out
  const rowLists = [
    ...(main ? [main] : []),
    ...extra.map((id) => activeLists.find((l) => l.id === id && !l.is_default)).filter((l) => l !== undefined),
  ]
  const unused = activeLists.filter((l) => !rowLists.includes(l))
  const addRow = () => unused[0] && setExtra([...extra, unused[0].id])
  const removeRow = (id: number) => {
    setExtra(extra.filter((x) => x !== id))
    setPrices({ ...prices, [id]: '' })
    clear(`price-${id}`)
  }
  const switchRow = (from: number, to: number) => {
    setExtra(extra.map((x) => (x === from ? to : x)))
    setPrices({ ...prices, [to]: prices[from] ?? '', [from]: '' })
    clear(`price-${from}`)
  }
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const [taken, setTaken] = useState<'sku' | 'barcode' | null>(null)
  const [failed, setFailed] = useState(false)
  const [newCategory, setNewCategory] = useState<string | null>(null)

  const clear = (k: string) => invalid.has(k) && setInvalid(new Set([...invalid].filter((x) => x !== k)))
  const set = (k: 'name' | 'sku' | 'barcode' | 'mxik' | 'note') => (e: { target: { value: string } }) => {
    setF({ ...f, [k]: e.target.value })
    clear(k)
    if (k === taken) setTaken(null)
  }

  function addCategory() {
    const name = newCategory?.trim()
    if (!name) return setNewCategory(null)
    saveCategory.mutate(
      { name },
      {
        onSuccess: (c) => {
          setF({ ...f, category_id: c.id })
          setNewCategory(null)
        },
        onError: (err) => toast.error(t(err instanceof ApiError && err.status === 409 ? 'nameTaken' : 'notSaved')),
      },
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const bad = new Set<string>()
    if (!f.name.trim()) bad.add('name')
    const min = minStock.trim() ? (minStock.trim() === '0' ? '0' : parsePositive(minStock, 3)) : null
    if (min === undefined) bad.add('min_stock')
    const unitCost = parseAmount(cost)
    if (unitCost === undefined) bad.add('cost')
    // every active list is sent: a row's price, or null to remove a price whose row was taken away
    const parsed = activeLists.map((l) => {
      const amount = rowLists.includes(l) ? parseAmount(prices[l.id] ?? '') : null
      if (amount === undefined) bad.add(`price-${l.id}`)
      return { price_list_id: l.id, amount: amount ?? null }
    })
    if (bad.size) return setInvalid(bad)
    setFailed(false)
    save.mutate(
      { id: product?.id, ...f, min_stock: min ?? null, cost: unitCost ?? null, prices: parsed },
      {
        onSuccess: (saved) => {
          toast.success(t('saved'))
          close()
          if (!product) navigate({ to: '/products/$productId', params: { productId: String(saved.id) } })
        },
        onError: (err) => {
          const field = err instanceof ApiError && err.body?.field
          if (field === 'sku' || field === 'barcode') setTaken(field)
          else if (err instanceof ApiError && err.status === 422) setInvalid(invalidFields(err))
          else setFailed(true)
        },
      },
    )
  }

  function setArchived(archived: boolean) {
    if (!product) return
    save.mutate(
      { id: product.id, archived },
      {
        onSuccess: () => {
          toast.success(t(archived ? 'productArchived' : 'productRestored'))
          close()
        },
        onError: () => setFailed(true),
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field id="product-name" label={t('productName')} error={invalid.has('name') && t('invalidName')}>
        <Input value={f.name} onChange={set('name')} maxLength={200} autoComplete="off" autoFocus />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="product-sku" label={t('sku')} optional={t('optional')} error={taken === 'sku' && t('skuTaken')}>
          <Input value={f.sku} onChange={set('sku')} maxLength={64} autoComplete="off" />
        </Field>
        <Field id="product-barcode" label={t('barcode')} optional={t('optional')} error={taken === 'barcode' && t('barcodeTaken')}>
          <Input value={f.barcode} onChange={set('barcode')} inputMode="numeric" maxLength={64} autoComplete="off" />
        </Field>
        {/* Selects take the label on their trigger, so these two don't go through Field */}
        <div className="grid content-start gap-1.5">
          <Label htmlFor="product-unit">{t('unit')}</Label>
          <Select value={f.unit} onValueChange={(v) => setF({ ...f, unit: v as Unit })}>
            <SelectTrigger id="product-unit" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map((u) => (
                <SelectItem key={u} value={u}>{t(`unit_${u}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="product-category">
            {t('category')}
            <span className="font-normal text-muted-foreground">({t('optional')})</span>
          </Label>
          {newCategory === null ? (
            <div className="flex gap-2">
              <Select value={f.category_id ? String(f.category_id) : 'none'} onValueChange={(v) => setF({ ...f, category_id: v === 'none' ? null : Number(v) })}>
                <SelectTrigger id="product-category" className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('noCategory')}</SelectItem>
                  {categories.data?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" size="icon" variant="outline" aria-label={t('newCategory')} title={t('newCategory')} onClick={() => setNewCategory('')}>
                <Plus aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                id="product-category"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCategory()
                  } else if (e.key === 'Escape') {
                    e.stopPropagation()
                    setNewCategory(null)
                  }
                }}
                placeholder={t('newCategory')}
                aria-label={t('newCategory')}
                maxLength={200}
                autoFocus
              />
              <Button type="button" variant="secondary" disabled={saveCategory.isPending} onClick={addCategory}>
                {t('add')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {main && (
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-sm font-medium">{t('prices')}</legend>
          {rowLists.map((l) => {
            const amount = parseAmount(prices[l.id] ?? '')
            const hint = showEquivalent && amount && equivalent(amount, l.currency)
            const error = (invalid.has(`price-${l.id}`) || invalid.has('prices')) && t('invalidPrice')
            const choices = [l, ...unused]
            return (
              <div key={l.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_2.25rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_2.25rem]">
                {l === main ? (
                  <Label htmlFor={`product-price-${l.id}`} className="h-9 min-w-0 truncate px-1">
                    {l.name}
                  </Label>
                ) : (
                  <Select value={String(l.id)} onValueChange={(v) => switchRow(l.id, Number(v))}>
                    <SelectTrigger className="w-full min-w-0" aria-label={t('priceList')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {choices.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <PriceInput
                  id={`product-price-${l.id}`}
                  value={prices[l.id] ?? ''}
                  currency={currencyLabel(l.currency, lang)}
                  aria-label={l === main ? undefined : `${t('prices')}: ${l.name}`}
                  aria-invalid={!!error || undefined}
                  aria-describedby={error || hint ? `product-price-${l.id}-note` : undefined}
                  onChange={(v) => {
                    setPrices({ ...prices, [l.id]: v })
                    clear(`price-${l.id}`)
                  }}
                />
                {l === main ? (
                  <span aria-hidden="true" />
                ) : (
                  <Button type="button" size="icon" variant="ghost" aria-label={`${t('removePrice')}: ${l.name}`} title={t('removePrice')} onClick={() => removeRow(l.id)}>
                    <X aria-hidden="true" />
                  </Button>
                )}
                {(error || hint) && (
                  <p id={`product-price-${l.id}-note`} className={`col-span-full -mt-1 px-1 text-right text-xs sm:pr-11 ${error ? 'text-red' : 'text-muted-foreground'}`}>
                    {error || hint}
                  </p>
                )}
              </div>
            )
          })}
          {unused.length > 0 && (
            <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={addRow}>
              <Plus aria-hidden="true" /> {t('addPrice')}
            </Button>
          )}
        </fieldset>
      )}

      <Field id="product-cost" label={t('costShort')} optional={t('optional')} hint={t('costHint')} error={invalid.has('cost') && t('invalidPrice')}>
        <PriceInput value={cost} currency={base ? currencyLabel(base, lang) : ''} onChange={(v) => (setCost(v), clear('cost'))} />
      </Field>
      <Field id="product-min" label={t('minStock')} optional={t('optional')} hint={t('minStockHint')} error={invalid.has('min_stock') && t('invalidQuantity')}>
        <Input value={minStock} onChange={(e) => (setMinStock(e.target.value), clear('min_stock'))} inputMode="decimal" maxLength={20} autoComplete="off" className="text-right tabular-nums sm:w-40" />
      </Field>
      <Field id="product-mxik" label={t('mxik')} optional={t('optional')} hint={t('mxikHint')} error={invalid.has('mxik') && t('invalidMxik')}>
        <Input value={f.mxik} onChange={set('mxik')} inputMode="numeric" maxLength={30} autoComplete="off" />
      </Field>
      <Field id="product-note" label={t('note')} optional={t('optional')}>
        <Textarea value={f.note} onChange={set('note')} maxLength={2000} rows={2} />
      </Field>

      {failed && (
        <p role="alert" className="flex items-center gap-2 rounded-2xl bg-red/10 px-3.5 py-2.5 text-sm text-red">
          <AlertCircle className="size-4 flex-none" aria-hidden="true" />
          {t('notSaved')}
        </p>
      )}

      <DialogFooter className="sm:items-center">
        {product && (
          <Button type="button" variant="ghost" className="sm:mr-auto" disabled={save.isPending} onClick={() => setArchived(!product.archived)}>
            {product.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
            {t(product.archived ? 'restore' : 'archive')}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={close}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {t('save')}
        </Button>
      </DialogFooter>
    </form>
  )
}

// A price box with the list's currency inside it, on the right.
type PriceInputProps = { value: string; currency: string; onChange: (v: string) => void; id?: string; 'aria-label'?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }
function PriceInput({ value, currency, onChange, ...rest }: PriceInputProps) {
  return (
    <div className="relative">
      <Input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        maxLength={24}
        className="pr-16 text-right tabular-nums"
      />
      <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-sm text-muted-foreground">{currency}</span>
    </div>
  )
}
