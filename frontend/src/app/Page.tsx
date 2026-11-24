// The top of every page: title, a line of explanation and the page's main actions.
import type { ReactNode } from 'react'

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="rise mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {description && <div className="text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

// A friendly empty or error state inside a glass panel; bare when it sits in a panel already.
export function EmptyState({ icon, title, text, action, bare }: { icon: ReactNode; title: string; text: string; action?: ReactNode; bare?: boolean }) {
  return (
    <section className={`${bare ? '' : 'glass rise '}grid justify-items-center gap-3 px-6 py-14 text-center`} style={{ '--i': 1 } as React.CSSProperties}>
      {icon}
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
      {action}
    </section>
  )
}
