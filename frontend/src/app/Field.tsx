// A labelled form field with an optional hint and an error, wired for screen readers.
import { cloneElement, type ReactElement } from 'react'
import { AlertCircle } from 'lucide-react'
import { Label } from '@/components/ui/label'

type Props = {
  id: string
  label: string
  optional?: string // the word "optional", shown after the label
  hint?: string
  error?: string | false | null
  children: ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>
}

export default function Field({ id, label, optional, hint, error, children }: Props) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">({optional})</span>}
      </Label>
      {cloneElement(children, { id, 'aria-invalid': !!error || undefined, 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1.5 text-xs text-red">
          <AlertCircle className="size-3.5 flex-none" aria-hidden="true" />
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  )
}
