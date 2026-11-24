// Pick a record (a product, a customer) by typing part of its name or code, in any script. An
// accessible combobox: arrows move through the matches, Enter picks, Escape closes. A barcode
// scanner types the code and presses Enter, so a single match is picked straight away.
import { useId, useState, type KeyboardEvent } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useDebounced } from './useDebounced'

type Props<T> = {
  value: T | null
  onChange: (item: T) => void
  // the matches for what was typed (any script), at most `limit`
  search: (q: string, limit: number) => Promise<T[]>
  queryKey: string
  label: (item: T) => string
  detail?: (item: T) => string | null
  placeholder: string
  noMatches: string
  id?: string
  invalid?: boolean
  autoFocus?: boolean
}

export default function Picker<T extends { id: number }>({ value, onChange, search, queryKey, label, detail, placeholder, noMatches, id, invalid, autoFocus }: Props<T>) {
  const list = useId()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const q = useDebounced(text.trim(), 200)
  const matches = useQuery({
    queryKey: [queryKey, 'pick', q],
    queryFn: () => search(q, 20),
    enabled: open,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const items = matches.data ?? []

  const pick = (p: T) => {
    onChange(p)
    setText('')
    setOpen(false)
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((a) => (items.length ? (a + step + items.length) % items.length : 0))
    } else if (e.key === 'Enter') {
      // Enter never submits the document from here
      e.preventDefault()
      const typed = text.trim()
      if (open && q === typed && items[active]) return pick(items[active])
      // typed faster than the search (a scanner): look it up now, and take it if it's the only one
      if (typed)
        search(typed, 2)
          .then((found) => (found.length === 1 ? pick(found[0]) : setOpen(true)))
          .catch(() => setOpen(true))
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation() // close the list, not the page's dialog
      setOpen(false)
    }
  }

  return (
    <Popover open={open && text.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id={id}
            role="combobox"
            aria-expanded={open && text.length > 0}
            aria-controls={list}
            aria-autocomplete="list"
            aria-activedescendant={open && items[active] ? `${list}-${items[active].id}` : undefined}
            aria-invalid={invalid || undefined}
            value={text}
            placeholder={value ? label(value) : placeholder}
            onChange={(e) => {
              setText(e.target.value)
              setActive(0)
              setOpen(true)
            }}
            onKeyDown={onKey}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            autoComplete="off"
            autoFocus={autoFocus}
            // the chosen product reads as the box's text until the user types over it
            className={`pl-9 ${value ? 'placeholder:text-(--text)' : ''}`}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-72 p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ul id={list} role="listbox" aria-label={placeholder} className="grid max-h-72 overflow-y-auto">
          {items.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">{matches.isFetching ? '…' : noMatches}</li>}
          {items.map((p, i) => (
            <li
              key={p.id}
              id={`${list}-${p.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${i === active ? 'bg-(--soft-2)' : ''}`}
            >
              <span className="truncate">{label(p)}</span>
              {detail?.(p) && <span className="flex-none text-xs text-muted-foreground">{detail(p)}</span>}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
