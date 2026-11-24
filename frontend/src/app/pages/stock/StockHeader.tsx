// The top of the stock pages: title, the actions that make documents, and links between balances
// and documents.
import { useState, type CSSProperties } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeftRight, MinusCircle, PlusCircle, Warehouse as WarehouseIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '../../Page'
import { usePrefs } from '../../prefs'
import WarehousesDialog from './WarehousesDialog'
import { useCan } from '../../session'

export default function StockHeader() {
  const { t } = usePrefs()
  const can = useCan()
  const [warehouses, setWarehouses] = useState(false)
  const tab = 'rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-(--text)'
  return (
    <>
      <PageHeader
        title={t('stock')}
        description={t('stockIntro')}
        actions={
          can('stock.write') && (
          <>
            <Button variant="outline" onClick={() => setWarehouses(true)}>
              <WarehouseIcon aria-hidden="true" /> {t('warehouses')}
            </Button>
            <Button asChild variant="outline">
              <Link to="/stock/documents/new" search={{ kind: 'transfer' }}>
                <ArrowLeftRight aria-hidden="true" /> {t('kindTransfer')}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/stock/documents/new" search={{ kind: 'write_off' }}>
                <MinusCircle aria-hidden="true" /> {t('kindWriteOff')}
              </Link>
            </Button>
            <Button asChild>
              <Link to="/stock/documents/new" search={{ kind: 'receipt' }}>
                <PlusCircle aria-hidden="true" /> {t('kindReceipt')}
              </Link>
            </Button>
          </>
          )
        }
      />
      <nav className="rise mb-4 inline-flex gap-1 rounded-full glass-field p-1" style={{ '--i': 1 } as CSSProperties} aria-label={t('stock')}>
        <Link to="/stock" activeOptions={{ exact: true, includeSearch: false }} className={tab} activeProps={{ className: 'bg-(--soft-2) text-(--text)', 'aria-current': 'page' }}>
          {t('balancesTab')}
        </Link>
        <Link to="/stock/documents" activeOptions={{ exact: true, includeSearch: false }} className={tab} activeProps={{ className: 'bg-(--soft-2) text-(--text)', 'aria-current': 'page' }}>
          {t('documentsTab')}
        </Link>
      </nav>
      <WarehousesDialog open={warehouses} onOpenChange={setWarehouses} />
    </>
  )
}
