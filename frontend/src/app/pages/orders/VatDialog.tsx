// The company's VAT (QQS) rates by date. Prices include VAT; an order uses the rate valid on its
// date. A company that doesn't pay VAT adds nothing.
import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '../../api'
import { formatDay, localDate } from '../../dates'
import { formatDecimal } from '../../money'
import { useOrderMutations, vatRatesQuery } from '../../orders'
import { usePrefs } from '../../prefs'

export default function VatDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, lang } = usePrefs()
  const rates = useQuery({ ...vatRatesQuery, enabled: open })
  const { addVat, deleteVat } = useOrderMutations()
  const [rate, setRate] = useState('12')
  const [from, setFrom] = useState(() => `${new Date().getFullYear()}-01-01`)

  function add(e: FormEvent) {
    e.preventDefault()
    const r = rate.replace(',', '.').trim()
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(r) || !from) return toast.error(t('invalidRate'))
    addVat.mutate(
      { rate: r, valid_from: from },
      { onError: (err) => toast.error(t(err instanceof ApiError && err.status === 409 ? 'nameTaken' : 'notSaved')) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('vatRates')}</DialogTitle>
          <DialogDescription>{t('vatIntro')}</DialogDescription>
        </DialogHeader>
        {rates.data?.length === 0 && <p className="text-sm text-muted-foreground">{t('noVatRates')}</p>}
        <ul className="grid">
          {rates.data?.map((r) => (
            <li key={r.id} className="flex min-h-12 items-center gap-3 border-b border-(--line) py-2 last:border-0">
              <span className="flex-1">
                <strong className="tabular-nums">{formatDecimal(r.rate)}%</strong>
                <span className="text-muted-foreground"> · {t('validFrom')}: {formatDay(localDate(r.valid_from), lang)}</span>
              </span>
              <Button size="icon-sm" variant="ghost" aria-label={`${t('delete')}: ${formatDecimal(r.rate)}%`} disabled={deleteVat.isPending} onClick={() => deleteVat.mutate(r.id)}>
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="vat-rate">{t('ratePercent')}</Label>
            <Input id="vat-rate" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className="w-24 text-right" />
          </div>
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="vat-from">{t('validFrom')}</Label>
            <Input id="vat-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary" disabled={addVat.isPending}>{t('add')}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
