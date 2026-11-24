// A task. An existing one opens to be read, like an issue in Jira: its column (changeable right
// there), priority, due date, links, note and history, with Edit for the form. A new one (or a
// "remind me" draft) opens straight on the form: what, its column and priority, by when (a day,
// optionally a time), about which customer.
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, CalendarDays, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { searchCustomers } from '../../customers'
import Field from '../../Field'
import Picker from '../../Picker'
import { usePrefs } from '../../prefs'
import { daysSince, formatDay, localDate } from '../../dates'
import { PRIORITIES, PRIORITY_COLOR, PRIORITY_KEY, STAGE_VAR, stagesQuery, taskQuery, useTaskMutations, type Priority, type Task, type TaskFields } from '../../tasks'
import Timeline from '../../Timeline'
import { useMe } from '../../session'
import { staffQuery } from '../../staff'

type Customer = { id: number; name: string }
// what a new task starts with: e.g. from a customer's page, the customer and a suggested title
export type TaskDraft = Partial<TaskFields> & { customer_name?: string }
type Props = { open: boolean; onOpenChange: (open: boolean) => void; task?: Task; draft?: TaskDraft }

export default function TaskDialog({ open, onOpenChange, task, draft }: Props) {
  const { t } = usePrefs()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {/* mounted only while open, so every opening starts on the view, from the saved values */}
        {task ? (
          <Existing task={task} close={() => onOpenChange(false)} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('newTask')}</DialogTitle>
              <DialogDescription className="sr-only">{t('tasksIntro')}</DialogDescription>
            </DialogHeader>
            <Form draft={draft} close={() => onOpenChange(false)} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// the task kept fresh, so a change made in the view (its column) shows at once
function Existing({ task: given, close }: { task: Task; close: () => void }) {
  const { t } = usePrefs()
  const task = useQuery({ ...taskQuery(given.id), initialData: given }).data
  const [editing, setEditing] = useState(false)
  return editing ? (
    <>
      <DialogHeader>
        <DialogTitle>{t('editTask')}</DialogTitle>
        <DialogDescription className="sr-only">{task.title}</DialogDescription>
      </DialogHeader>
      {/* Cancel and Save return to the view, as in Jira */}
      <Form task={task} close={() => setEditing(false)} />
    </>
  ) : (
    <View task={task} onEdit={() => setEditing(true)} close={close} />
  )
}

function View({ task, onEdit, close }: { task: Task; onEdit: () => void; close: () => void }) {
  const { t, lang } = usePrefs()
  const { save, remove } = useTaskMutations()
  const stages = useQuery(stagesQuery).data ?? []
  const done = task.done_at !== null
  const days = task.due_date ? daysSince(task.due_date) : null
  const late = !done && days !== null && days > 0
  const priority = PRIORITY_COLOR[task.priority]
  const row = (label: string, value: ReactNode) =>
    value && (
      <div className="grid grid-cols-[8rem_1fr] gap-3 text-sm">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="min-w-0 break-words">{value}</dd>
      </div>
    )
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle className={`pr-8 text-xl leading-snug break-words ${done ? 'text-muted-foreground line-through' : ''}`}>{task.title}</DialogTitle>
        <DialogDescription className="sr-only">{t('tasksIntro')}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-2">
        {/* the column, changed right here like Jira's status button */}
        <Select value={String(task.stage_id)} onValueChange={(v) => save.mutate({ id: task.id, stage_id: Number(v) }, { onError: () => toast.error(t('notSaved')) })}>
          <SelectTrigger className="h-8 w-auto gap-2" aria-label={t('state')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {stages.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                <span className="size-2 rounded-full" style={{ background: STAGE_VAR[s.color] }} aria-hidden="true" />
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {task.priority !== 'normal' && (
          <span className="rounded-full px-2 py-1 text-xs font-medium" style={{ color: priority ?? undefined, background: `color-mix(in srgb, ${priority} 15%, transparent)` }}>
            {t(PRIORITY_KEY[task.priority])}
          </span>
        )}
        {task.due_date && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${late ? 'bg-red/15 text-red' : 'bg-(--soft-2)'}`}>
            <CalendarDays className="size-3.5" aria-hidden="true" />
            {days === 0 ? t('today') : days === -1 ? t('tomorrow') : formatDay(localDate(task.due_date), lang)}
            {task.due_time && ` ${task.due_time.slice(0, 5)}`}
            {late && ` · ${t('lateBy')} ${days} ${t('daysShort')}`}
          </span>
        )}
      </div>
      <dl className="grid gap-2">
        {row(
          t('customer'),
          task.customer_id && (
            <Link to="/customers/$customerId" params={{ customerId: String(task.customer_id) }} onClick={close} className="font-medium hover:underline">
              {task.customer_name}
            </Link>
          ),
        )}
        {row(
          t('order'),
          task.order_id && (
            <Link to="/orders/$orderId" params={{ orderId: String(task.order_id) }} onClick={close} className="font-medium hover:underline">
              № {task.order_number}
            </Link>
          ),
        )}
        {row(t('assignee'), task.assignee_name)}
        {row(t('addedOn'), formatDay(new Date(task.created_at), lang))}
      </dl>
      {task.note ? (
        <p className="rounded-2xl bg-(--soft) px-3.5 py-3 text-sm break-words whitespace-pre-line">{task.note}</p>
      ) : (
        <button type="button" onClick={onEdit} className="rounded-2xl border border-dashed border-(--line) px-3.5 py-3 text-left text-sm text-muted-foreground hover:text-(--text)">
          {t('addTaskNote')}
        </button>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          className="sm:mr-auto"
          disabled={remove.isPending}
          onClick={() => remove.mutate(task.id, { onSuccess: () => (toast.success(t('taskDeleted')), close()), onError: () => toast.error(t('notSaved')) })}
        >
          <Trash2 aria-hidden="true" /> {t('delete')}
        </Button>
        <Button type="button" onClick={onEdit} autoFocus>
          <Pencil aria-hidden="true" /> {t('edit')}
        </Button>
      </DialogFooter>
      <section className="grid gap-2 border-t border-(--line) pt-3" aria-label={t('history')}>
        <h3 className="text-sm font-semibold">{t('history')}</h3>
        <Timeline scope={{ entity: 'task', entityId: task.id }} />
      </section>
    </div>
  )
}

// the form: a new task (closes when saved) or an existing one (back to its view when saved)
function Form({ task, draft, close }: { task?: Task; draft?: TaskDraft; close: () => void }) {
  const { t } = usePrefs()
  const { save } = useTaskMutations()
  const start = task ?? draft
  const [title, setTitle] = useState(start?.title ?? '')
  const [note, setNote] = useState(start?.note ?? '')
  const [date, setDate] = useState(start?.due_date ?? '')
  const [time, setTime] = useState(start?.due_time?.slice(0, 5) ?? '')
  const stages = useQuery(stagesQuery).data ?? []
  // a new task goes to the first open column unless it was started in another
  const [stageId, setStageId] = useState<number | null>(start?.stage_id ?? null)
  const stage = stageId ?? stages.find((s) => !s.done)?.id
  const [priority, setPriority] = useState<Priority>(start?.priority ?? 'normal')
  // who does it: anyone active in the company; a new task is the creator's unless chosen
  const me = useMe().data
  const people = (useQuery(staffQuery).data ?? []).filter((p) => p.active || p.id === start?.assignee_id)
  const [assignee, setAssignee] = useState<number | null>(start?.assignee_id ?? me?.id ?? null)
  const [customer, setCustomer] = useState<Customer | null>(start?.customer_id ? { id: start.customer_id, name: start.customer_name ?? '' } : null)
  const [bad, setBad] = useState(false)
  const [failed, setFailed] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setBad(true)
    setFailed(false)
    save.mutate(
      {
        id: task?.id,
        title,
        note,
        stage_id: stage ?? null,
        assignee_id: assignee,
        priority,
        due_date: date || null,
        // a time means nothing without a day
        due_time: date && time ? time : null,
        customer_id: customer?.id ?? null,
        order_id: task ? task.order_id : (draft?.order_id ?? null),
      },
      { onSuccess: () => (toast.success(t('saved')), close()), onError: () => setFailed(true) },
    )
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <Field id="task-title" label={t('taskTitle')} error={bad && t('invalidTaskTitle')}>
        <Input value={title} onChange={(e) => (setTitle(e.target.value), setBad(false))} maxLength={200} autoComplete="off" autoFocus placeholder={t('taskTitleHint')} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="task-status">{t('state')}</Label>
          <Select value={stage ? String(stage) : undefined} onValueChange={(v) => setStageId(Number(v))}>
            <SelectTrigger id="task-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stages.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  <span className="size-2 rounded-full" style={{ background: STAGE_VAR[s.color] }} aria-hidden="true" />
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="task-priority">{t('priority')}</Label>
          <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
            <SelectTrigger id="task-priority" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  <span className="size-2 rounded-full" style={{ background: PRIORITY_COLOR[p] ?? 'var(--soft-2)' }} aria-hidden="true" />
                  {t(PRIORITY_KEY[p])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="task-assignee">{t('assignee')}</Label>
        <Select value={assignee ? String(assignee) : 'nobody'} onValueChange={(v) => setAssignee(v === 'nobody' ? null : Number(v))}>
          <SelectTrigger id="task-assignee" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="nobody">{t('nobody')}</SelectItem>
            {people.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
                {p.id === me?.id ? ` (${t('you')})` : ''}
                <span className="text-muted-foreground"> · {p.role}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* minmax(0, …): long labels (Russian) must not push the time box out of the dialog */}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)] gap-3">
        <Field id="task-date" label={t('dueOn')} optional={t('optional')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} max="9999-12-31" />
        </Field>
        {/* no "(optional)": it only unlocks once a day is chosen */}
        <Field id="task-time" label={t('atTime')}>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!date} />
        </Field>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="task-customer">
          {t('customer')} <span className="font-normal text-muted-foreground">({t('optional')})</span>
        </Label>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Picker id="task-customer" value={customer} onChange={setCustomer} search={searchCustomers} queryKey="customers" label={(c) => c.name} placeholder={t('chooseCustomer')} noMatches={t('noMatches')} />
          </div>
          {customer && (
            <Button type="button" variant="ghost" onClick={() => setCustomer(null)}>
              {t('clear')}
            </Button>
          )}
        </div>
      </div>
      <Field id="task-note" label={t('note')} optional={t('optional')}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} />
      </Field>
      {failed && (
        <p role="alert" className="flex items-center gap-2 rounded-2xl bg-red/10 px-3.5 py-2.5 text-sm text-red">
          <AlertCircle className="size-4 flex-none" aria-hidden="true" />
          {t('notSaved')}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close}>{t('cancel')}</Button>
        <Button type="submit" disabled={save.isPending}>{t('save')}</Button>
      </DialogFooter>
    </form>
  )
}
