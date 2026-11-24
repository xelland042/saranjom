// An order's payment state as a coloured badge, with its word (never colour alone).
import { Badge } from '@/components/ui/badge'
import { PAY_LABEL, type PayState } from '../../orders'
import { usePrefs } from '../../prefs'

const TONE: Record<PayState, string> = {
  paid: 'bg-green/15 text-green',
  partial: 'bg-amber/15 text-amber',
  unpaid: 'bg-(--soft-2) text-(--text)',
  overdue: 'bg-red/15 text-red',
}

export function PayBadge({ state }: { state: PayState }) {
  const { t } = usePrefs()
  return (
    <Badge variant="secondary" className={TONE[state]}>
      {t(PAY_LABEL[state])}
    </Badge>
  )
}
