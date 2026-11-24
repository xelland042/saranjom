// The 1C export: a period's confirmed sales and payments as an EnterpriseData file, which the
// accountant loads in 1C:Бухгалтерия. Asks once for the company's ИНН, which 1C finds it by, and
// its bank account, which bank payments must name.
import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, invalidFields } from '../../api'
import Field from '../../Field'
import { DateRange, downloadFile, presetRange, type Range } from '../../ListTools'
import { usePrefs } from '../../prefs'
import { meQuery, useMe } from '../../session'

export default function OneCDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = usePrefs()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('export1c')}</DialogTitle>
          <DialogDescription>{t('export1cText')}</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t('export1cVat')}</p>
        <p className="text-xs text-muted-foreground">{t('export1cBank')}</p>
        <Body close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ close }: { close: () => void }) {
  const { t } = usePrefs()
  const qc = useQueryClient()
  const me = useMe().data
  // accountants usually send last month
  const [range, setRange] = useState<Range>(() => presetRange('lastMonth'))
  const [version, setVersion] = useState('1.4')
  const [inn, setInn] = useState('')
  const [account, setAccount] = useState('')
  // 1C finds the organisation by name, so the name must be 1C's own spelling
  const savedName = me?.company_onec_name ?? me?.company_name ?? ''
  const [name, setName] = useState(savedName)
  const [bad, setBad] = useState<'inn' | 'bank_account' | 'onec_name' | 'period' | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const needInn = !me?.company_inn
  // asked when missing; the server says when the period's bank payments need it
  const askAccount = !me?.company_bank_account

  async function submit(e: FormEvent) {
    e.preventDefault()
    setFailed(false)
    if (!range.from || !range.to) return setBad('period')
    const digits = inn.replace(/\s/g, '')
    if (needInn && !/^(\d{9}|\d{14})$/.test(digits)) return setBad('inn')
    const accountDigits = account.replace(/\s/g, '')
    if (accountDigits && !/^\d{20}$/.test(accountDigits)) return setBad('bank_account')
    if (!name.trim()) return setBad('onec_name')
    setBad(null)
    setBusy(true)
    try {
      const company = {
        ...(needInn ? { inn: digits } : {}),
        ...(accountDigits ? { bank_account: accountDigits } : {}),
        ...(name.trim() !== me?.company_onec_name ? { onec_name: name.trim() } : {}),
      }
      if (Object.keys(company).length) {
        await api('/company', company, 'PATCH')
        await qc.invalidateQueries({ queryKey: meQuery.queryKey })
      }
      await downloadFile('/onec/export', { date_from: range.from, date_to: range.to, version })
      close()
    } catch (err) {
      const fields = invalidFields(err)
      if (fields.has('inn')) setBad('inn')
      else if (fields.has('bank_account')) setBad('bank_account')
      else setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-1.5">
        <Label>{t('period')}</Label>
        <DateRange value={range} onChange={setRange} />
        {bad === 'period' && <p className="text-xs text-red">{t('pickPeriod')}</p>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="onec-version">{t('formatVersion')}</Label>
        <Select value={version} onValueChange={setVersion}>
          <SelectTrigger id="onec-version" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1.4">1.4</SelectItem>
            <SelectItem value="1.5">1.5</SelectItem>
            <SelectItem value="1.8">1.8</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('formatVersionHint')}</p>
      </div>
      <Field id="onec-name" label={t('onecName')} hint={t('onecNameHint')} error={bad === 'onec_name' && t('invalidName')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="off" />
      </Field>
      {needInn && (
        <Field id="onec-inn" label={t('companyInn')} hint={t('companyInnHint')} error={bad === 'inn' && t('innHint')}>
          <Input value={inn} onChange={(e) => setInn(e.target.value)} inputMode="numeric" maxLength={20} autoComplete="off" />
        </Field>
      )}
      {askAccount && (
        <Field id="onec-account" label={t('bankAccount')} optional={t('optional')} hint={t('bankAccountHint')} error={bad === 'bank_account' && t('bankAccountHint')}>
          <Input value={account} onChange={(e) => setAccount(e.target.value)} inputMode="numeric" maxLength={30} autoComplete="off" />
        </Field>
      )}
      {failed && (
        <p role="alert" className="flex items-center gap-2 rounded-2xl bg-red/10 px-3.5 py-2.5 text-sm text-red">
          <AlertCircle className="size-4 flex-none" aria-hidden="true" />
          {t('exportFailed')}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close}>{t('cancel')}</Button>
        <Button type="submit" disabled={busy}>
          <Download aria-hidden="true" /> {t('download')}
        </Button>
      </DialogFooter>
    </form>
  )
}
