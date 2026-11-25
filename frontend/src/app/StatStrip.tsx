// A row of key numbers above a list ("4 open, 1 late..."). A number with a link applies that
// filter. On phones the row scrolls sideways instead of taking half the screen.
import type { CSSProperties } from 'react'
import { Link, type LinkProps } from '@tanstack/react-router'

export type Stat = { label: string; value: string | number; tone?: 'red' | 'amber' | 'green'; link?: LinkProps }

const TONE = { red: 'text-red', amber: 'text-amber', green: 'text-green' }

export default function StatStrip({ stats, i = 1 }: { stats: Stat[]; i?: number }) {
  const cols = stats.length >= 5 ? 'sm:grid-cols-3 lg:grid-cols-5' : stats.length === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'
  return (
    <div className={`rise -mx-4 mb-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:overflow-visible sm:px-0 sm:pb-0 ${cols}`} style={{ '--i': i } as CSSProperties}>
      {stats.map((s) => {
        const body = (
          <>
            <span className="truncate text-xs text-muted-foreground">{s.label}</span>
            <strong className={`truncate text-xl tabular-nums ${s.tone ? TONE[s.tone] : ''}`}>{s.value}</strong>
          </>
        )
        const box = 'glass grid min-w-36 flex-none gap-0.5 px-4 py-3 sm:min-w-0'
        return s.link ? (
          <Link key={s.label} {...s.link} className={`${box} focus-visible:outline-2 focus-visible:outline-(--accent)`}>
            {body}
          </Link>
        ) : (
          <div key={s.label} className={box}>
            {body}
          </div>
        )
      })}
    </div>
  )
}
