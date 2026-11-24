// The last 30 days' sales as thin bars: one series, so no legend (the title names it); today's
// bar in the accent, the rest softer; hovering or focusing a bar shows its day and sum. A table
// with the same numbers is there for screen readers.
import { useState } from 'react'
import { formatDay, localDate } from '../../dates'
import { formatAmount, formatMoney } from '../../money'
import { usePrefs } from '../../prefs'

type Day = { date: string; total: string }

// a round top for the axis: 1, 2 or 5 times a power of ten
function niceMax(v: number) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p
}
// "1.2 mln", "850 ming" for the axis, where full numbers would crowd it
function short(v: number, lang: string) {
  const [mln, ming] = lang === 'ru' ? ['млн', 'тыс.'] : lang === 'uz-Cyrl' ? ['млн', 'минг'] : ['mln', 'ming']
  if (v >= 1e6) return `${formatAmount(String(Math.round(v / 1e5) / 10)).replace('.', ',')} ${mln}`
  if (v >= 1e3) return `${Math.round(v / 1e3)} ${ming}`
  return String(v)
}

export default function SalesChart({ days, currency }: { days: Day[]; currency: string }) {
  const { t, lang } = usePrefs()
  const [hover, setHover] = useState<number | null>(null)
  const values = days.map((d) => Number(d.total))
  const top = niceMax(Math.max(...values))
  // no sales at all: a message, not an empty grid with a made-up 0-1 scale
  const empty = values.every((v) => v === 0)
  const W = 600
  const H = 180
  const left = 52
  const bottom = 22
  const pad = 12 // room above the top line for its label
  const step = (W - left) / days.length
  const bar = Math.max(2, step - 2) // a 2px gap between bars
  const y = (v: number) => pad + (H - bottom - pad) * (1 - v / top)
  const shown = hover ?? days.length - 1

  return (
    <figure className="grid gap-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-lg font-semibold">{t('sales30')}</span>
        <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
          {formatDay(localDate(days[shown].date), lang)}: <strong className="text-(--text)">{formatMoney(days[shown].total, currency, lang)}</strong>
        </span>
      </figcaption>
      {empty && <p className="py-10 text-center text-sm text-muted-foreground">{t('noSales30')}</p>}
      <svg viewBox={`0 0 ${W} ${H}`} className={`h-auto w-full ${empty ? 'hidden' : ''}`} role="img" aria-label={t('sales30')} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={left} x2={W} y1={y(top * f)} y2={y(top * f)} stroke="var(--line)" strokeWidth="1" />
            <text x={left - 8} y={y(top * f) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)">
              {short(top * f, lang)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const v = values[i]
          const h = Math.max(v > 0 ? 2 : 0, H - bottom - y(v))
          const x = left + i * step + (step - bar) / 2
          const r = Math.min(4, bar / 2, h)
          const today = i === days.length - 1
          return (
            <g key={d.date}>
              {/* a hit area the full height of the plot, bigger than the bar */}
              <rect x={left + i * step} y={0} width={step} height={H - bottom} fill="transparent" onMouseEnter={() => setHover(i)} />
              {h > 0 && (
                <path
                  d={`M${x},${H - bottom} v${-(h - r)} q0,${-r} ${r},${-r} h${bar - 2 * r} q${r},0 ${r},${r} v${h - r} z`}
                  fill={today || hover === i ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 60%, transparent)'}
                  pointerEvents="none"
                />
              )}
              {(i === 0 || i === days.length - 1 || i % 7 === (days.length - 1) % 7) && (
                <text x={left + i * step + step / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--text-3)">
                  {localDate(d.date).getDate()}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {/* a table's caption is drawn outside the table's own box, so the wrapper is what hides it */}
      <div className="sr-only">
        <table>
          <caption>{t('sales30')}</caption>
          <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <th scope="row">{formatDay(localDate(d.date), lang)}</th>
              <td>{formatMoney(d.total, currency, lang)}</td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
