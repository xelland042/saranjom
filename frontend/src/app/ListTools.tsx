// Tools shared by the lists: sortable column headers, a date range with presets, and the Excel
// button. Their state lives in the address, like the search box, so a filtered list can be
// bookmarked or sent to a colleague.
import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { isoToday } from './dates'
import type { Key } from './i18n'
import { usePrefs } from './prefs'

// ---------- sortable header ----------

// `sort` is "field" (ascending) or "-field" (descending). The first click on a column sorts the way
// people usually want it: biggest and newest first for numbers and dates, A to Z for names.
export function SortHeader({
  label,
  field,
  sort,
  onSort,
  descFirst = false,
  className = '',
  align = 'left',
}: {
  label: string
  field: string
  sort: string
  onSort: (next: string) => void
  descFirst?: boolean
  className?: string
  align?: 'left' | 'right'
}) {
  const active = sort.replace(/^-/, '') === field
  const desc = sort.startsWith('-')
  const next = active ? (desc ? field : `-${field}`) : descFirst ? `-${field}` : field
  const Icon = !active ? ChevronsUpDown : desc ? ArrowDown : ArrowUp
  return (
    <th scope="col" aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'} className={`px-4 py-3 font-medium ${className}`}>
      <button
        type="button"
        onClick={() => onSort(next)}
        className={`inline-flex items-center gap-1 rounded-md hover:text-(--text) focus-visible:outline-2 focus-visible:outline-(--accent) ${align === 'right' ? 'flex-row-reverse' : ''} ${active ? 'text-(--text)' : ''}`}
      >
        {label}
        <Icon className={`size-3.5 ${active ? '' : 'opacity-40'}`} aria-hidden="true" />
      </button>
    </th>
  )
}

// ---------- date range ----------

export type Range = { from?: string; to?: string }
const PRESETS = ['all', 'today', 'week', 'month', 'lastMonth', 'custom'] as const
type Preset = (typeof PRESETS)[number]
const PRESET_LABEL: Record<Preset, Key> = {
  all: 'rangeAll',
  today: 'today',
  week: 'rangeWeek',
  month: 'rangeMonth',
  lastMonth: 'rangeLastMonth',
  custom: 'rangeCustom',
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// the dates a preset stands for, counted from today (weeks start on Monday)
export function presetRange(p: Preset): Range {
  const now = new Date()
  const today = isoToday()
  if (p === 'today') return { from: today, to: today }
  if (p === 'week') {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
    return { from: iso(monday), to: today }
  }
  if (p === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: today }
  if (p === 'lastMonth') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) }
  return {}
}

const presetOf = (r: Range): Preset =>
  !r.from && !r.to ? 'all' : (PRESETS.find((p) => p !== 'all' && p !== 'custom' && presetRange(p).from === r.from && presetRange(p).to === r.to) ?? 'custom')

export function DateRange({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const { t } = usePrefs()
  // "custom" stays chosen while its dates are being picked, even before they differ from a preset
  const [custom, setCustom] = useState(false)
  const preset = custom ? 'custom' : presetOf(value)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={preset}
        onValueChange={(v) => {
          setCustom(v === 'custom')
          if (v !== 'custom') onChange(presetRange(v as Preset))
        }}
      >
        <SelectTrigger className="w-40" aria-label={t('period')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => (
            <SelectItem key={p} value={p}>{t(PRESET_LABEL[p])}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {preset === 'custom' && (
        <>
          <Input type="date" className="w-40" aria-label={t('dateFrom')} value={value.from ?? ''} max={value.to} onChange={(e) => onChange({ ...value, from: e.target.value || undefined })} />
          <Input type="date" className="w-40" aria-label={t('dateTo')} value={value.to ?? ''} min={value.from} max="9999-12-31" onChange={(e) => onChange({ ...value, to: e.target.value || undefined })} />
        </>
      )}
    </div>
  )
}

// ---------- Excel ----------

// Fetches a file the server builds and hands it to the browser to save, under the server's name.
export async function downloadFile(path: string, params: Record<string, string | number | boolean | undefined>) {
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') query.set(k, String(v))
  const r = await fetch(`/api/v1${path}?${query}`)
  if (!r.ok) throw new Error(String(r.status))
  const name = decodeURIComponent(r.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? 'export')
  const url = URL.createObjectURL(await r.blob())
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Downloads the list as filtered, in the screen's language. The server builds the file, so numbers
// and dates arrive as numbers and dates, not text.
export function ExportButton({ path, params }: { path: string; params: Record<string, string | number | boolean | undefined> }) {
  const { t, lang } = usePrefs()
  const [busy, setBusy] = useState(false)
  async function download() {
    setBusy(true)
    try {
      await downloadFile(path, { lang, ...params })
    } catch {
      toast.error(t('exportFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="outline" onClick={download} disabled={busy}>
      <FileSpreadsheet aria-hidden="true" /> Excel
    </Button>
  )
}
