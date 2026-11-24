import type { CSSProperties } from 'react'
import { Link } from '@tanstack/react-router'
import { Compass } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '../Page'
import { usePrefs } from '../prefs'

export default function NotFound() {
  const { t } = usePrefs()
  return (
    <EmptyState
      icon={
        <span className="tile" style={{ '--c': 'var(--violet)', '--t': '52px' } as CSSProperties} aria-hidden="true">
          <Compass className="size-6" />
        </span>
      }
      title={t('notFound')}
      text={t('notFoundText')}
      action={
        <Button asChild variant="secondary">
          <Link to="/">{t('goHome')}</Link>
        </Button>
      }
    />
  )
}
