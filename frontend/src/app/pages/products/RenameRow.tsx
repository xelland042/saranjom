// A list row turned into a name box with Save and Cancel; Enter saves, Escape cancels.
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePrefs } from '../../prefs'

type Props = { initial: string; busy: boolean; onSave: (name: string) => void; onCancel: () => void }

export default function RenameRow({ initial, busy, onSave, onCancel }: Props) {
  const { t } = usePrefs()
  const [name, setName] = useState(initial)
  const save = () => (name.trim() && name.trim() !== initial ? onSave(name.trim()) : onCancel())
  return (
    <div className="flex flex-1 gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape') {
            // close only this box, not the whole dialog
            e.stopPropagation()
            onCancel()
          }
        }}
        aria-label={t('rename')}
        maxLength={200}
        autoFocus
      />
      <Button type="button" size="sm" className="h-9" disabled={busy} onClick={save}>
        {t('save')}
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-9" onClick={onCancel}>
        {t('cancel')}
      </Button>
    </div>
  )
}
