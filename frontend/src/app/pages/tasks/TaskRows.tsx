// Tasks as a list of rows: a tick to finish one (with undo), its title (opens it), when it's due
// and about whom. Used on the tasks page and on a customer's page.
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { daysSince, formatDay, localDate } from '../../dates'
import { usePrefs } from '../../prefs'
import { PRIORITY_COLOR, PRIORITY_KEY, STAGE_VAR, stagesQuery, useTaskMutations, type Task } from '../../tasks'

// "Bugun 17:00", "Ertaga", "2026-yil 3-dekabr"; late ones in red
export function DueLabel({ task }: { task: Task }) {
  const { t, lang } = usePrefs()
  if (!task.due_date) return null
  const days = daysSince(task.due_date)
  const day = days === 0 ? t('today') : days === -1 ? t('tomorrow') : formatDay(localDate(task.due_date), lang)
  const late = !task.done_at && days > 0
  return (
    <span className={`whitespace-nowrap tabular-nums ${late ? 'text-red' : ''}`}>
      {day}
      {task.due_time && ` ${task.due_time.slice(0, 5)}`}
      {late && ` · ${t('lateBy')} ${days} ${t('daysShort')}`}
    </span>
  )
}

export default function TaskRows({ tasks, onOpen, showCustomer = true }: { tasks: Task[]; onOpen: (task: Task) => void; showCustomer?: boolean }) {
  const { t } = usePrefs()
  const { setDone } = useTaskMutations()
  const stages = useQuery(stagesQuery).data ?? []
  const firstOpen = stages.find((x) => !x.done)?.id
  const tick = (task: Task, done: boolean, undoable = true) =>
    setDone.mutate(
      { id: task.id, done },
      {
        onSuccess: () =>
          done &&
          toast.success(t('taskDone'), { action: undoable ? { label: t('undo'), onClick: () => tick(task, false, false) } : undefined }),
        onError: () => toast.error(t('notSaved')),
      },
    )
  return (
    <ul className="grid">
      {tasks.map((task) => {
        const stage = stages.find((x) => x.id === task.stage_id)
        return (
        <li key={task.id} className="flex items-start gap-3 border-b border-(--line) px-1 py-2.5 last:border-0">
          <Checkbox className="mt-0.5" checked={!!task.done_at} onCheckedChange={(v) => tick(task, v === true)} aria-label={`${t('markDone')}: ${task.title}`} />
          <span className="grid min-w-0 flex-1 gap-0.5">
            <button
              type="button"
              onClick={() => onOpen(task)}
              className={`truncate text-left font-medium hover:underline focus-visible:underline focus-visible:outline-none ${task.done_at ? 'text-muted-foreground line-through' : ''}`}
            >
              {task.title}
            </button>
            <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              {task.priority !== 'normal' && (
                <span className="inline-flex items-center gap-1" style={{ color: PRIORITY_COLOR[task.priority] ?? undefined }}>
                  <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                  {t(PRIORITY_KEY[task.priority])}
                </span>
              )}
              {/* its column, unless it's simply the first open one (where every task starts) */}
              {stage && stage.id !== firstOpen && (
                <span className="inline-flex items-center gap-1">
                  <span className="size-1.5 rounded-full" style={{ background: STAGE_VAR[stage.color] }} aria-hidden="true" />
                  {stage.name}
                </span>
              )}
              <DueLabel task={task} />
              {showCustomer && task.customer_id && (
                <Link to="/customers/$customerId" params={{ customerId: String(task.customer_id) }} className="truncate hover:text-(--text) hover:underline">
                  {task.customer_name}
                </Link>
              )}
              {task.order_id && (
                <Link to="/orders/$orderId" params={{ orderId: String(task.order_id) }} className="hover:text-(--text) hover:underline">
                  {t('order')} № {task.order_number}
                </Link>
              )}
            </span>
          </span>
        </li>
        )
      })}
    </ul>
  )
}
