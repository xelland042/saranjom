// Loading a firm's customers or products from its own Excel file (an export from 1C or any
// sheet): pick the file, check which column is which (the server guesses from the headers), see
// what would change, then import. The preview is the import itself run without saving, so what
// it shows is what gets saved. Rows with mistakes are listed and skipped.
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Download, FileUp } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from './api'
import { isoToday } from './dates'
import type { Key } from './i18n'
import { downloadFile } from './ListTools'
import { currencyLabel } from './money'
import { usePrefs } from './prefs'
import { priceListsQuery } from './products'
import { useCan } from './session'
import { warehousesQuery } from './stock'

type Kind = 'customers' | 'products'
type Sheet = { columns: string[]; rows: { row: number; cells: (string | null)[] }[]; guess: Record<string, number> }
type RowError = { row: number; field: string; code: 'missing' | 'invalid' | 'unit' | 'repeats' | 'taken' | 'ambiguous' | 'archived'; other: number | null }
type Result = { created: number; new_rows: number[]; updated: number; unchanged: number; debts: number; errors: RowError[]; stock: { id: number; kind: string; number: number }[] }

// our fields in the order shown, each with its label; the first one is required
const FIELDS: Record<Kind, { field: string; label: Key }[]> = {
  customers: [
    { field: 'name', label: 'customerName' },
    { field: 'inn', label: 'inn' },
    { field: 'phone', label: 'phone' },
    { field: 'address', label: 'address' },
    { field: 'payment_days', label: 'paymentDays' },
    { field: 'debt', label: 'openingDebt' },
  ],
  products: [
    { field: 'name', label: 'productName' },
    { field: 'sku', label: 'sku' },
    { field: 'barcode', label: 'barcode' },
    { field: 'unit', label: 'unit' },
    { field: 'category', label: 'category' },
    { field: 'mxik', label: 'mxik' },
    { field: 'price', label: 'price' },
    { field: 'quantity', label: 'importStock' },
  ],
}

const NONE = '-'

function pick(columns: Record<string, number>, field: string, value: string) {
  const next = { ...columns }
  if (value === NONE) delete next[field]
  else next[field] = Number(value)
  return next
}

export default function ImportDialog({ kind, open, onOpenChange }: { kind: Kind; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = usePrefs()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t(kind === 'customers' ? 'importCustomers' : 'importProducts')}</DialogTitle>
          <DialogDescription>{t(kind === 'customers' ? 'importCustomersText' : 'importProductsText')}</DialogDescription>
        </DialogHeader>
        {/* mounted only while open, so it starts from the file step every time */}
        <Body kind={kind} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ kind, close }: { kind: Kind; close: () => void }) {
  const { t, lang } = usePrefs()
  const can = useCan()
  const qc = useQueryClient()
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [columns, setColumns] = useState<Record<string, number>>({})
  const [preview, setPreview] = useState<Result | null>(null)
  // rows the person left out (1C's folder rows), and every row a preview found would be new
  const [left, setLeft] = useState<Set<number>>(new Set())
  const [fresh, setFresh] = useState<number[]>([])
  const [fileError, setFileError] = useState(false)
  const [reading, setReading] = useState(false)
  const lists = useQuery(priceListsQuery).data ?? []
  const own = lists.find((l) => l.is_default)?.currency ?? 'UZS'
  const [currency, setCurrency] = useState<string | null>(null)
  const warehouses = (useQuery({ ...warehousesQuery, enabled: kind === 'products' }).data ?? []).filter((w) => !w.archived)
  const [warehouse, setWarehouse] = useState<number | null>(null)
  const [date, setDate] = useState(isoToday())
  const fileInput = useRef<HTMLInputElement>(null)

  // what this person may bring in: opening debts are money, stock needs the stock permission
  const fields = FIELDS[kind].filter((f) => (f.field !== 'debt' || can('money.write')) && (f.field !== 'quantity' || can('stock.write')))
  const withDebt = columns.debt !== undefined
  const withStock = columns.quantity !== undefined
  const warehouseId = warehouse ?? warehouses.find((w) => w.is_default)?.id ?? warehouses[0]?.id

  async function read(file: File) {
    setFileError(false)
    setReading(true)
    try {
      const r = await fetch(`/api/v1/import/${kind}/read`, { method: 'POST', body: file })
      if (!r.ok) throw new Error(String(r.status))
      const s: Sheet = await r.json()
      setSheet(s)
      const allowed = new Set(fields.map((f) => f.field))
      setColumns(Object.fromEntries(Object.entries(s.guess).filter(([f]) => allowed.has(f))))
    } catch {
      setFileError(true)
    } finally {
      setReading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  function body(dryRun: boolean, skip = left) {
    const rows = sheet!.rows.filter((r) => !skip.has(r.row)).map((r) => ({ row: r.row, ...Object.fromEntries(Object.entries(columns).map(([f, i]) => [f, r.cells[i]])) }))
    const options = kind === 'customers' ? { currency: withDebt ? (currency ?? own) : undefined } : { warehouse_id: withStock ? warehouseId : undefined, note: t('importNote') }
    return { rows, dry_run: dryRun, date, ...options }
  }

  const check = useMutation({
    mutationFn: (skip: Set<number>) => api<Result>(`/import/${kind}`, body(true, skip)),
    onSuccess: (r) => {
      setPreview(r)
      setFresh((f) => [...new Set([...f, ...r.new_rows])].sort((a, b) => a - b))
    },
  })
  // leaving a row out (or back in) counts again, so the preview stays exactly what gets saved
  function toggle(row: number, keep: boolean) {
    const next = new Set(left)
    if (keep) next.delete(row)
    else next.add(row)
    setLeft(next)
    check.mutate(next)
  }
  function backToColumns() {
    setPreview(null)
    setLeft(new Set())
    setFresh([])
  }
  const save = useMutation({
    mutationFn: () => api<Result>(`/import/${kind}`, body(false)),
    onSuccess: async (r) => {
      toast.success(`${t('imported')}: ${summary(r)}`)
      const keys = kind === 'customers' ? ['customers', 'debts'] : ['products', 'stock']
      await Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })))
      close()
    },
  })

  function summary(r: Result) {
    return [
      r.created && `${t('importNew')} ${r.created}`,
      r.updated && `${t('importUpdated')} ${r.updated}`,
      r.unchanged && `${t('importSame')} ${r.unchanged}`,
    ]
      .filter(Boolean)
      .join(', ')
  }

  const label = (field: string) => t(FIELDS[kind].find((f) => f.field === field)?.label ?? 'name')
  function errorText(e: RowError) {
    const what = e.code === 'repeats' ? t('importRepeats').replace('{row}', String(e.other)) : t(`importErr_${e.code}` as Key)
    return `${t('importRow')} ${e.row} · ${label(e.field)}: ${what}`
  }

  // ---------- 1. the file ----------
  if (!sheet)
    return (
      <div className="grid gap-4">
        <input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" tabIndex={-1} onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
        <Button type="button" size="lg" onClick={() => fileInput.current?.click()} disabled={reading}>
          <FileUp aria-hidden="true" /> {reading ? t('importReading') : t('importPick')}
        </Button>
        <p className="text-sm text-muted-foreground">{t('importFileHint')}</p>
        {fileError && <Problem text={t('importBadFile')} />}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => downloadFile(`/import/${kind}/template`, { lang }).catch(() => toast.error(t('exportFailed')))}>
            <Download aria-hidden="true" /> {t('importTemplate')}
          </Button>
          <Button type="button" variant="ghost" onClick={close}>{t('cancel')}</Button>
        </DialogFooter>
      </div>
    )

  // ---------- 3. what would change ----------
  if (preview) {
    const nothing = !preview.created && !preview.updated && !preview.debts && !preview.stock.length
    const docs = (k: string) => preview.stock.filter((d) => d.kind === k).length
    const nameOf = new Map(sheet.rows.map((r) => [r.row, r.cells[columns.name]]))
    return (
      <div className="grid gap-4">
        <ul className="grid gap-1 text-sm">
          <li>{t('importNew')}: <b>{preview.created}</b></li>
          <li>{t('importUpdated')}: <b>{preview.updated}</b></li>
          <li>{t('importSame')}: <b>{preview.unchanged}</b></li>
          {withDebt && <li>{t('importDebts')}: <b>{preview.debts}</b></li>}
          {withStock && (
            <li>
              {t('importStockDocs')}: <b>{docs('receipt')}</b> {t('kindReceipt').toLowerCase()}, <b>{docs('write_off')}</b> {t('kindWriteOff').toLowerCase()}
            </li>
          )}
        </ul>
        {fresh.length > 0 && (
          <div className="grid gap-1.5">
            <p className="text-sm font-medium">{t('importNewList')}</p>
            <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-2xl border px-3.5 py-2.5 text-sm">
              {fresh.map((row) => (
                <li key={row}>
                  <label className="flex items-center gap-2">
                    <Checkbox checked={!left.has(row)} onCheckedChange={(v) => toggle(row, v === true)} />
                    <span className="w-10 flex-none text-xs text-muted-foreground tabular-nums">{row}</span>
                    <span className="truncate">{nameOf.get(row)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        {preview.errors.length > 0 && (
          <div className="grid gap-1.5">
            <p className="text-sm font-medium text-red">{t('importSkipped')}: {preview.errors.length}</p>
            <ul className="max-h-48 overflow-y-auto rounded-2xl bg-red/10 px-3.5 py-2.5 text-xs text-red">
              {preview.errors.map((e) => (
                <li key={`${e.row}-${e.field}`}>{errorText(e)}</li>
              ))}
            </ul>
          </div>
        )}
        {save.isError && <Problem text={t('notSaved')} />}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={backToColumns}>{t('back')}</Button>
          <Button type="button" onClick={() => save.mutate()} disabled={nothing || save.isPending || check.isPending}>
            {save.isPending ? t('importSaving') : t('importDo')}
          </Button>
        </DialogFooter>
      </div>
    )
  }

  // ---------- 2. which column is which ----------
  const sample = (i: number) => sheet.rows.find((r) => r.cells[i])?.cells[i]
  const currencies = [...new Set([own, ...lists.filter((l) => !l.archived).map((l) => l.currency)])]
  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        check.mutate(left)
      }}
    >
      <p className="text-sm text-muted-foreground">
        {t('importRows')}: <b>{sheet.rows.length}</b>. {t('importColumnsHint')}
      </p>
      <div className="grid max-h-[50vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
        {fields.map(({ field, label: l }) => (
          <div key={field} className="grid content-start gap-1.5">
            <Label htmlFor={`imp-${field}`}>{t(l)}</Label>
            <Select value={columns[field] === undefined ? NONE : String(columns[field])} onValueChange={(v) => setColumns((c) => pick(c, field, v))}>
              <SelectTrigger id={`imp-${field}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('importSkip')}</SelectItem>
                {sheet.columns.map((c, i) => (
                  <SelectItem key={i} value={String(i)}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {columns[field] !== undefined && <p className="truncate text-xs text-muted-foreground">{sample(columns[field]) ?? '—'}</p>}
          </div>
        ))}
      </div>
      {(withDebt || withStock) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {withDebt && (
            <div className="grid content-start gap-1.5">
              <Label htmlFor="imp-currency">{t('currency')}</Label>
              <Select value={currency ?? own} onValueChange={setCurrency}>
                <SelectTrigger id="imp-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => (
                    <SelectItem key={c} value={c}>{currencyLabel(c, lang)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {withStock && (
            <div className="grid content-start gap-1.5">
              <Label htmlFor="imp-warehouse">{t('warehouse')}</Label>
              <Select value={warehouseId === undefined ? undefined : String(warehouseId)} onValueChange={(v) => setWarehouse(Number(v))}>
                <SelectTrigger id="imp-warehouse">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid content-start gap-1.5">
            <Label htmlFor="imp-date">{t('importDate')}</Label>
            <Input id="imp-date" type="date" value={date} onChange={(e) => setDate(e.target.value || isoToday())} max="9999-12-31" />
          </div>
        </div>
      )}
      {withStock && <p className="text-xs text-muted-foreground">{t('importStockHint')}</p>}
      {columns.name === undefined && <Problem text={t('importNeedName')} />}
      {check.isError && <Problem text={t('importCheckFailed')} />}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => setSheet(null)}>{t('back')}</Button>
        <Button type="submit" disabled={columns.name === undefined || check.isPending}>
          {check.isPending ? t('importChecking') : t('importCheck')}
        </Button>
      </DialogFooter>
    </form>
  )
}

function Problem({ text }: { text: string }) {
  return (
    <p role="alert" className="flex items-center gap-2 rounded-2xl bg-red/10 px-3.5 py-2.5 text-sm text-red">
      <AlertCircle className="size-4 flex-none" aria-hidden="true" />
      {text}
    </p>
  )
}
