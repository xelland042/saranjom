// Exchange rates for the "≈ … soʻm" hints: the Central Bank's daily rate, or the company's own.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDay, localDate } from '../../dates'
import { currencyLabel, formatDecimal, parsePositive } from '../../money'
import { usePrefs } from '../../prefs'
import { ratesQuery, useProductMutations, type Rate } from '../../products'

export default function RatesSection({ enabled }: { enabled: boolean }) {
  const { t } = usePrefs()
  const rates = useQuery({ ...ratesQuery, enabled })
  if (!rates.data?.rates.length) return null
  return (
    <section className="grid gap-2" aria-labelledby="rates-title">
      <div>
        <h3 id="rates-title" className="text-sm font-medium">{t('exchangeRates')}</h3>
        <p className="text-xs text-muted-foreground">{t('ratesIntro')}</p>
      </div>
      <ul className="grid">
        {rates.data.rates.map((r) => (
          <RateRow key={r.currency} rate={r} base={rates.data.base} />
        ))}
      </ul>
    </section>
  )
}

function RateRow({ rate: r, base }: { rate: Rate; base: string }) {
  const { t, lang } = usePrefs()
  const { setRate } = useProductMutations()
  const [editing, setEditing] = useState(false)
  const [typed, setTyped] = useState('')
  const [bad, setBad] = useState(false)
  const baseLabel = currencyLabel(base, lang)

  function save() {
    const rate = parsePositive(typed, 6)
    if (!rate) return setBad(true)
    setRate.mutate({ currency: r.currency, rate }, { onSuccess: () => setEditing(false), onError: () => toast.error(t('notSaved')) })
  }

  const source =
    r.source === 'company'
      ? `${t('ownRate')}${r.cbu_rate ? ` · ${t('cbuSource')}: ${formatDecimal(r.cbu_rate)}` : ''}`
      : r.source === 'cbu' && r.cbu_date
        ? `${t('cbuSource')} · ${formatDay(localDate(r.cbu_date), lang)}`
        : t('noRate')

  return (
    <li className="grid gap-2 border-b border-(--line) py-2.5 last:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="grid min-w-0 flex-1 basis-48">
          <span className="font-medium tabular-nums">
            {r.rate ? `1 ${r.currency} = ${formatDecimal(r.rate)} ${baseLabel}` : `1 ${r.currency} = ?`}
          </span>
          <small className="text-muted-foreground">{source}</small>
        </span>
        {!editing && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setTyped(r.rate ? formatDecimal(r.rate) : '')
              setBad(false)
              setEditing(true)
            }}
          >
            {t('setOwnRate')}
          </Button>
        )}
        {!editing && r.source === 'company' && (
          <Button size="sm" variant="ghost" disabled={setRate.isPending} onClick={() => setRate.mutate({ currency: r.currency, rate: null })}>
            {t('useCbuRate')}
          </Button>
        )}
      </div>
      {editing && (
        <div className="grid gap-1">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Input
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value)
                  setBad(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    save()
                  } else if (e.key === 'Escape') {
                    e.stopPropagation()
                    setEditing(false)
                  }
                }}
                aria-label={`${t('ownRate')}: 1 ${r.currency}`}
                aria-invalid={bad || undefined}
                inputMode="decimal"
                className="pr-16 text-right tabular-nums"
                autoFocus
              />
              <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-sm text-muted-foreground">{baseLabel}</span>
            </div>
            <Button size="sm" className="h-9" disabled={setRate.isPending} onClick={save}>
              {t('save')}
            </Button>
            <Button size="sm" variant="ghost" className="h-9" onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
          </div>
          {bad && <p className="text-xs text-red">{t('invalidRate')}</p>}
        </div>
      )}
    </li>
  )
}
