// The top of the money pages: title, "receive a payment", and links between debts, payments, the
// cash box and bank, and the profit report.
import { useState, type CSSProperties } from 'react'
import { Link } from '@tanstack/react-router'
import { FileCode2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '../../Page'
import { usePrefs } from '../../prefs'
import OneCDialog from './OneCDialog'
import PaymentDialog from './PaymentDialog'
import { useCan } from '../../session'

export default function MoneyHeader() {
  const { t } = usePrefs()
  const can = useCan()
  const [paying, setPaying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const tab = 'whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-(--text)'
  const active = { className: 'bg-(--soft-2) text-(--text)', 'aria-current': 'page' as const }
  return (
    <>
      <PageHeader
        title={t('debts')}
        description={t('debtsIntro')}
        actions={
          <>
            {can('orders.read') && (
              <Button variant="outline" onClick={() => setExporting(true)}>
                <FileCode2 aria-hidden="true" /> {t('export1c')}
              </Button>
            )}
            {can('money.write') && (
              <Button onClick={() => setPaying(true)}>
                <Plus aria-hidden="true" /> {t('receivePayment')}
              </Button>
            )}
          </>
        }
      />
      <nav className="rise mb-4 inline-flex max-w-full gap-1 overflow-x-auto rounded-full glass-field p-1" style={{ '--i': 1 } as CSSProperties} aria-label={t('debts')}>
        <Link to="/debts" activeOptions={{ exact: true, includeSearch: false }} className={tab} activeProps={active}>
          {t('debtsTab')}
        </Link>
        <Link to="/payments" activeOptions={{ exact: true, includeSearch: false }} className={tab} activeProps={active}>
          {t('paymentsTab')}
        </Link>
        <Link to="/cash" activeOptions={{ exact: true, includeSearch: false }} className={tab} activeProps={active}>
          {t('cashTab')}
        </Link>
        <Link to="/profit" activeOptions={{ exact: true, includeSearch: false }} className={tab} activeProps={active}>
          {t('profitTab')}
        </Link>
      </nav>
      <PaymentDialog open={paying} onOpenChange={setPaying} />
      <OneCDialog open={exporting} onOpenChange={setExporting} />
    </>
  )
}
