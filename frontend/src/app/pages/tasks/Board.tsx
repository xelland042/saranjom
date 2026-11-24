// The task board, like Jira or Trello: the company's own columns (named, coloured, ordered; each
// either open or done), added at the end and changed from their header's menu. A card is dragged
// by any part of it (a click still opens it): it follows the pointer from where it was grabbed,
// the other cards slide aside, and it glides into place when dropped. Touch (hold briefly) and the
// keyboard (Space, arrows, Space) work too; the card's menu moves it without dragging.
import { useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react'
import {
  closestCorners,
  defaultDropAnimationSideEffects,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DropAnimation,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, CalendarDays, Check, CircleCheck, MoreHorizontal, Pencil, Plus, ShoppingCart, StickyNote, Trash2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ApiError } from '../../api'
import { daysSince, formatDay, localDate } from '../../dates'
import type { Key } from '../../i18n'
import { usePrefs } from '../../prefs'
import { PRIORITIES, PRIORITY_COLOR, PRIORITY_KEY, STAGE_COLORS, STAGE_VAR, useTaskMutations, type Stage, type Task } from '../../tasks'
import { useCan } from '../../session'

const STEP = 1024
type Columns = Record<number, number[]> // stage id -> card ids, in order
const columnId = (stageId: number) => `column-${stageId}`

// the position for something put at `index` among `items` (which don't include it): halfway
// between its new neighbours, so one move writes one row
function positionAt(items: { position: number }[], index: number) {
  const before = items[index - 1]?.position
  const after = items[index]?.position
  if (before === undefined && after === undefined) return 0
  if (before === undefined) return after! - STEP
  if (after === undefined) return before + STEP
  return (before + after) / 2
}

const group = (stages: Stage[], tasks: Task[]): Columns => Object.fromEntries(stages.map((s) => [s.id, tasks.filter((x) => x.stage_id === s.id).map((x) => x.id)]))

// the column a card, or a column's own drop area, belongs to
function columnOf(id: UniqueIdentifier, columns: Columns): number | undefined {
  if (typeof id === 'string') return Number(id.replace('column-', ''))
  const found = Object.entries(columns).find(([, ids]) => ids.includes(id as number))
  return found ? Number(found[0]) : undefined
}

// The keyboard picks up a card only when the card itself has focus: Enter on its title opens it,
// Space on its menu button opens the menu
class CardKeyboardSensor extends KeyboardSensor {
  static activators = [
    {
      eventName: 'onKeyDown' as const,
      handler: (event: KeyboardEvent<Element>, options: Parameters<(typeof KeyboardSensor.activators)[0]['handler']>[1], context: Parameters<(typeof KeyboardSensor.activators)[0]['handler']>[2]) =>
        event.target === event.currentTarget && KeyboardSensor.activators[0].handler(event, options, context),
    },
  ]
}

// the drop glides the card into place; with reduced motion it just appears there
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const DROP: DropAnimation | null = reduced
  ? null
  : { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.35' } } }) }

export default function Board({ stages, tasks, onOpen }: { stages: Stage[]; tasks: Task[]; onOpen: (task: Task) => void }) {
  const { t } = usePrefs()
  const { move } = useTaskMutations()
  // changing the columns themselves is for roles allowed to; moving cards is for everyone
  const editable = useCan()('tasks.columns')
  const byId = new Map(tasks.map((x) => [x.id, x]))
  const stageById = new Map(stages.map((s) => [s.id, s]))
  const server = group(stages, tasks)
  // While a card is dragged: the columns as they're being rearranged. After the drop they stay
  // until the new order arrives (`tasks` changes), so the card doesn't flick back for a frame.
  const [drag, setDrag] = useState<{ id: number | null; columns: Columns; tasks: Task[] } | null>(null)
  const live = drag && (drag.id !== null || drag.tasks === tasks)
  const columns = live ? drag.columns : server
  const active = drag?.id != null ? byId.get(drag.id) : undefined

  const sensors = useSensors(
    // a few pixels of movement before dragging starts, so a click still opens the card
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // on phones a short hold, so a swipe still scrolls the page
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(CardKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const save = (task: Task, stageId: number, ids: number[]) => {
    const stage = stageById.get(stageId)!
    const index = ids.indexOf(task.id)
    const others = ids.filter((id) => id !== task.id).map((id) => byId.get(id)!)
    // dropped where it already was: nothing to save
    if (task.stage_id === stageId && server[stageId]?.indexOf(task.id) === index) return
    move.mutate(
      { id: task.id, stage, position: positionAt(others, index) },
      {
        onSuccess: () => stage.done && !task.done_at && toast.success(t('taskDone')),
        onError: () => toast.error(t('notSaved')),
      },
    )
  }

  // from the card's menu: to the top of a column
  const moveTo = (task: Task, stageId: number) => save(task, stageId, [task.id, ...(server[stageId] ?? []).filter((id) => id !== task.id)])

  function over({ active, over }: DragOverEvent) {
    if (!drag || !over) return
    const from = columnOf(active.id, drag.columns)
    const to = columnOf(over.id, drag.columns)
    if (from === undefined || to === undefined || from === to) return
    // into another column: just above the card under the pointer, or below it past its middle
    const target = drag.columns[to] ?? []
    const overIndex = target.indexOf(over.id as number)
    const rect = active.rect.current.translated
    const below = rect && overIndex >= 0 && rect.top + rect.height / 2 > over.rect.top + over.rect.height / 2
    const index = overIndex < 0 ? target.length : overIndex + (below ? 1 : 0)
    const id = active.id as number
    setDrag({
      ...drag,
      columns: { ...drag.columns, [from]: drag.columns[from].filter((x) => x !== id), [to]: [...target.slice(0, index), id, ...target.slice(index)] },
    })
  }

  function end({ active, over }: DragEndEvent) {
    const task = byId.get(active.id as number)
    if (!drag || !over || !task) return setDrag(null)
    const stageId = columnOf(active.id, drag.columns)!
    let ids = drag.columns[stageId]
    // within a column, sortable only showed the move: apply it
    if (typeof over.id === 'number' && ids.includes(over.id)) ids = arrayMove(ids, ids.indexOf(task.id), ids.indexOf(over.id))
    setDrag({ id: null, columns: { ...drag.columns, [stageId]: ids }, tasks })
    save(task, stageId, ids)
  }

  const name = (id: UniqueIdentifier) => byId.get(id as number)?.title ?? ''
  const where = (id: UniqueIdentifier | undefined) => {
    const col = id === undefined || !drag ? undefined : columnOf(id, drag.columns)
    return col === undefined ? '' : (stageById.get(col)?.name ?? '')
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={({ active }) => setDrag({ id: active.id as number, columns: server, tasks })}
      onDragOver={over}
      onDragEnd={end}
      onDragCancel={() => setDrag(null)}
      accessibility={{
        screenReaderInstructions: { draggable: t('dragHint') },
        announcements: {
          onDragStart: ({ active }) => `${name(active.id)}: ${t('dragPicked')}`,
          onDragOver: ({ active, over }) => `${name(active.id)} → ${where(over?.id)}`,
          onDragEnd: ({ active, over }) => `${name(active.id)} → ${where(over?.id)}`,
          onDragCancel: ({ active }) => `${name(active.id)}: ${t('dragCancelled')}`,
        },
      }}
    >
      {/* as many columns as fit side by side; more scroll sideways, like Trello */}
      <div className="-mx-4 flex snap-x items-start gap-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
        {stages.map((stage, ci) => (
          <Column
            key={stage.id}
            stage={stage}
            stages={stages}
            index={ci}
            ids={columns[stage.id] ?? []}
            byId={byId}
            hot={!!active && columnOf(active.id, columns) === stage.id}
            onOpen={onOpen}
            onMove={moveTo}
            server={server}
            editable={editable}
          />
        ))}
        {editable && <AddColumn stages={stages} />}
      </div>
      <DragOverlay dropAnimation={DROP}>
        {active && (
          // the card in hand: lifted, slightly tilted, under the pointer where it was grabbed
          <div className="rotate-[1.5deg] cursor-grabbing rounded-2xl shadow-[0_18px_40px_-12px_rgb(0_0_0/0.55)]">
            <Card task={active} stages={stages} onOpen={() => {}} onMove={() => {}} server={server} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

// ---------- columns ----------

type ColumnProps = {
  stage: Stage
  stages: Stage[]
  index: number
  ids: number[]
  byId: Map<number, Task>
  hot: boolean
  onOpen: (task: Task) => void
  onMove: (task: Task, stageId: number) => void
  server: Columns
  editable: boolean
}

function Column({ stage, stages, index, ids, byId, hot, onOpen, onMove, server, editable }: ColumnProps) {
  const { t } = usePrefs()
  const [renaming, setRenaming] = useState(false)
  // the column itself takes drops too, so an empty one (or its gaps) can receive a card
  const { setNodeRef } = useDroppable({ id: columnId(stage.id) })
  const color = STAGE_VAR[stage.color]
  return (
    <section
      aria-label={stage.name}
      className={`glass rise relative grid min-w-[14.5rem] flex-1 snap-start content-start gap-2 overflow-hidden p-3 max-lg:min-w-[85%] transition-[box-shadow] duration-200 ${hot ? 'ring-2 ring-(--accent)/60' : ''}`}
      // a band of its colour on top and a faint tint, so columns tell apart at a glance
      style={{ '--i': index + 2, backgroundImage: `linear-gradient(color-mix(in srgb, ${color} 10%, transparent), transparent 9rem)` } as CSSProperties}
    >
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: color }} aria-hidden="true" />
      <header className="flex min-h-8 items-center gap-2 px-1 pt-1">
        {renaming ? (
          <RenameStage stage={stage} done={() => setRenaming(false)} />
        ) : (
          <>
            <span className="size-2.5 flex-none rounded-full" style={{ background: color }} aria-hidden="true" />
            <h2 className="truncate text-sm font-semibold" onDoubleClick={() => editable && setRenaming(true)}>
              {stage.name}
            </h2>
            {stage.done && <CircleCheck className="size-3.5 flex-none text-green" aria-label={t('doneColumn')} />}
            <span className="rounded-full bg-(--soft-2) px-2 text-xs text-muted-foreground tabular-nums">{ids.length}</span>
            {editable ? <StageMenu stage={stage} stages={stages} onRename={() => setRenaming(true)} /> : <span className="ml-auto" />}
          </>
        )}
      </header>
      {!stage.done && <QuickAdd stage={stage} />}
      <SortableContext id={columnId(stage.id)} items={ids} strategy={verticalListSortingStrategy}>
        <ol ref={setNodeRef} className="grid min-h-20 gap-2 rounded-2xl">
          {ids.map((id) => {
            const task = byId.get(id)
            return task && <SortableCard key={id} task={task} stages={stages} onOpen={onOpen} onMove={onMove} server={server} />
          })}
          {ids.length === 0 && <li className="rounded-2xl border border-dashed border-(--line) px-3 py-5 text-center text-xs text-muted-foreground">{t('dropHere')}</li>}
        </ol>
      </SortableContext>
    </section>
  )
}

const errorText = (err: unknown): Key =>
  err instanceof ApiError && err.status === 409 ? 'nameTaken' : err instanceof ApiError && err.status === 422 ? 'needOpenAndDone' : 'notSaved'

function RenameStage({ stage, done }: { stage: Stage; done: () => void }) {
  const { t } = usePrefs()
  const { saveStage } = useTaskMutations()
  const [name, setName] = useState(stage.name)
  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!name.trim() || name.trim() === stage.name) return done()
    saveStage.mutate({ id: stage.id, name: name.trim() }, { onSuccess: done, onError: (err) => toast.error(t(errorText(err))) })
  }
  return (
    <form onSubmit={submit} className="flex flex-1 gap-1">
      <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => submit()} onKeyDown={(e) => e.key === 'Escape' && done()} maxLength={60} autoFocus aria-label={t('columnName')} className="h-8" />
    </form>
  )
}

function StageMenu({ stage, stages, onRename }: { stage: Stage; stages: Stage[]; onRename: () => void }) {
  const { t } = usePrefs()
  const { saveStage } = useTaskMutations()
  const [deleting, setDeleting] = useState(false)
  const i = stages.indexOf(stage)
  const change = (f: { name?: string; color?: Stage['color']; done?: boolean; position?: number }) =>
    saveStage.mutate({ id: stage.id, ...f }, { onError: (err) => toast.error(t(errorText(err))) })
  // a place between the neighbours on that side
  const shift = (dir: -1 | 1) => change({ position: positionAt(stages.filter((s) => s.id !== stage.id), i + dir) })
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label={`${t('columnActions')}: ${stage.name}`}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={onRename}>
            <Pencil aria-hidden="true" /> {t('rename')}
          </DropdownMenuItem>
          <DropdownMenuLabel>{t('color')}</DropdownMenuLabel>
          {/* the colours as swatches; the menu stays open so several can be tried */}
          <div className="grid grid-cols-8 gap-1.5 px-2 pb-2" role="group" aria-label={t('color')}>
            {STAGE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => change({ color: c })}
                aria-label={t(`color_${c}` as Key)}
                aria-pressed={stage.color === c}
                className="grid size-5 place-items-center rounded-full transition-transform hover:scale-115 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--accent)"
                style={{ background: STAGE_VAR[c], boxShadow: stage.color === c ? `0 0 0 2px var(--glass-strong), 0 0 0 3.5px ${STAGE_VAR[c]}` : undefined }}
              >
                {stage.color === c && <Check className="size-3 text-(--glass-strong)" strokeWidth={3} aria-hidden="true" />}
              </button>
            ))}
          </div>
          <DropdownMenuCheckboxItem checked={stage.done} onCheckedChange={(v) => change({ done: v === true })}>
            {t('doneColumn')}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {i > 0 && (
            <DropdownMenuItem onSelect={() => shift(-1)}>
              <ArrowLeft aria-hidden="true" /> {t('moveLeft')}
            </DropdownMenuItem>
          )}
          {i < stages.length - 1 && (
            <DropdownMenuItem onSelect={() => shift(1)}>
              <ArrowRight aria-hidden="true" /> {t('moveRight')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2 aria-hidden="true" /> {t('deleteColumn')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteStage stage={stage} stages={stages} open={deleting} onOpenChange={setDeleting} />
    </>
  )
}

// Deleting a column with cards asks where they go; the board always keeps an open and a done column.
function DeleteStage({ stage, stages, open, onOpenChange }: { stage: Stage; stages: Stage[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = usePrefs()
  const { removeStage } = useTaskMutations()
  const others = stages.filter((s) => s.id !== stage.id)
  const [chosen, setChosen] = useState<number | undefined>(undefined)
  const target = chosen ?? others.find((s) => s.done === stage.done)?.id ?? others[0]?.id
  const lastOfKind = !others.some((s) => s.done === stage.done)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('deleteColumn')}: {stage.name}
          </DialogTitle>
          <DialogDescription>{lastOfKind ? t('needOpenAndDone') : stage.tasks > 0 ? t('moveCardsFirst') : t('deleteColumnText')}</DialogDescription>
        </DialogHeader>
        {!lastOfKind && stage.tasks > 0 && (
          <Select value={target ? String(target) : undefined} onValueChange={(v) => setChosen(Number(v))}>
            <SelectTrigger className="w-full" aria-label={t('moveTo')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {others.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  <span className="size-2 rounded-full" style={{ background: STAGE_VAR[s.color] }} aria-hidden="true" />
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          {!lastOfKind && (
            <Button
              variant="destructive"
              disabled={removeStage.isPending}
              onClick={() =>
                removeStage.mutate(
                  { id: stage.id, moveTo: stage.tasks > 0 ? target : undefined },
                  { onSuccess: () => onOpenChange(false), onError: (err) => toast.error(t(errorText(err))) },
                )
              }
            >
              <Trash2 aria-hidden="true" /> {t('delete')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddColumn({ stages }: { stages: Stage[] }) {
  const { t } = usePrefs()
  const { saveStage } = useTaskMutations()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  // the next colour not yet taken, so a new column stands out from its neighbours
  const color = STAGE_COLORS.find((c) => !stages.some((s) => s.color === c)) ?? 'gray'
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setOpen(false)
    saveStage.mutate({ name: name.trim(), color }, { onSuccess: () => (setName(''), setOpen(false)), onError: (err) => toast.error(t(errorText(err))) })
  }
  return (
    <div className="w-56 flex-none snap-start rounded-(--radius) border border-dashed border-(--line) p-3">
      {open ? (
        <form onSubmit={submit} className="grid gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} placeholder={t('columnNameHint')} aria-label={t('columnName')} maxLength={60} autoFocus />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={saveStage.isPending}>
              {t('add')}
            </Button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-1.5 rounded-xl px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-(--soft) hover:text-(--text)">
          <Plus className="size-4" aria-hidden="true" /> {t('addColumn')}
        </button>
      )}
    </div>
  )
}

// ---------- cards ----------

function SortableCard(props: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.id })
  return (
    <li
      ref={setNodeRef}
      // the others slide aside smoothly; the dragged one stays as a faint placeholder
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`touch-manipulation rounded-2xl focus-visible:outline-2 focus-visible:outline-(--accent) ${isDragging ? 'opacity-35' : ''}`}
      {...attributes}
      {...listeners}
    >
      <Card {...props} />
    </li>
  )
}

function QuickAdd({ stage }: { stage: Stage }) {
  const { t } = usePrefs()
  const { save } = useTaskMutations()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setOpen(false)
    save.mutate({ title: title.trim(), stage_id: stage.id }, { onSuccess: () => setTitle(''), onError: () => toast.error(t('notSaved')) })
  }
  return open ? (
    <form onSubmit={submit} className="flex gap-2">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && (setOpen(false), setTitle(''))}
        onBlur={() => !title.trim() && setOpen(false)}
        placeholder={t('taskTitleHint')}
        aria-label={`${t('newTask')}: ${stage.name}`}
        maxLength={200}
        autoFocus
      />
      <Button type="submit" size="icon" aria-label={t('add')} disabled={save.isPending}>
        <Plus aria-hidden="true" />
      </Button>
    </form>
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-(--soft) hover:text-(--text)"
    >
      <Plus className="size-4" aria-hidden="true" /> {t('addTask')}
    </button>
  )
}

type CardProps = {
  task: Task
  stages: Stage[]
  onOpen: (task: Task) => void
  onMove: (task: Task, stageId: number) => void
  server: Columns
}

function Card({ task, stages, onOpen, onMove, server }: CardProps) {
  const { t, lang } = usePrefs()
  const { save } = useTaskMutations()
  const done = task.done_at !== null
  const late = !done && task.due_date !== null && daysSince(task.due_date) > 0
  const days = task.due_date ? daysSince(task.due_date) : null
  const due = task.due_date && (days === 0 ? t('today') : days === -1 ? t('tomorrow') : formatDay(localDate(task.due_date), lang))
  const stripe = PRIORITY_COLOR[task.priority]
  return (
    <article
      data-card={task.id}
      className={`group relative cursor-grab overflow-hidden rounded-2xl border border-(--line) bg-(--soft) p-3 transition-colors hover:bg-(--soft-2) active:cursor-grabbing ${done ? 'opacity-70' : ''}`}
    >
      {stripe && <span className="absolute inset-y-0 left-0 w-1" style={{ background: stripe }} aria-hidden="true" />}
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onOpen(task)}
          className={`min-w-0 flex-1 text-left text-sm font-medium break-words after:absolute after:inset-0 focus-visible:outline-none after:focus-visible:rounded-2xl after:focus-visible:outline-2 after:focus-visible:outline-(--accent) ${done ? 'line-through' : ''}`}
        >
          {task.title}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" className="relative z-10 -mt-1 -mr-1 opacity-60 group-hover:opacity-100" aria-label={`${t('actions')}: ${task.title}`}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('moveTo')}</DropdownMenuLabel>
            {stages
              .filter((s) => s.id !== task.stage_id)
              .map((s) => (
                <DropdownMenuItem key={s.id} onSelect={() => onMove(task, s.id)}>
                  <span className="size-2 rounded-full" style={{ background: STAGE_VAR[s.color] }} aria-hidden="true" />
                  {s.name}
                </DropdownMenuItem>
              ))}
            {(server[task.stage_id]?.indexOf(task.id) ?? 0) > 0 && <DropdownMenuItem onSelect={() => onMove(task, task.stage_id)}>{t('toTop')}</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('priority')}</DropdownMenuLabel>
            {PRIORITIES.filter((p) => p !== task.priority).map((p) => (
              <DropdownMenuItem key={p} onSelect={() => save.mutate({ id: task.id, priority: p })}>
                <span className="size-2 rounded-full" style={{ background: PRIORITY_COLOR[p] ?? 'var(--soft-2)' }} aria-hidden="true" />
                {t(PRIORITY_KEY[p])}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {task.priority !== 'normal' && (
          <span className="rounded-full px-1.5 py-0.5 font-medium" style={{ color: stripe ?? undefined, background: `color-mix(in srgb, ${stripe} 15%, transparent)` }}>
            {t(PRIORITY_KEY[task.priority])}
          </span>
        )}
        {due && (
          <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 ${late ? 'bg-red/15 text-red' : 'bg-(--soft-2)'}`}>
            <CalendarDays className="size-3" aria-hidden="true" />
            {due}
            {task.due_time && ` ${task.due_time.slice(0, 5)}`}
          </span>
        )}
        {task.customer_id && (
          <Link
            to="/customers/$customerId"
            params={{ customerId: String(task.customer_id) }}
            className="relative z-10 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-(--soft-2) px-1.5 py-0.5 hover:text-(--text)"
          >
            <UserRound className="size-3 flex-none" aria-hidden="true" />
            <span className="truncate">{task.customer_name}</span>
          </Link>
        )}
        {task.order_id && (
          <Link to="/orders/$orderId" params={{ orderId: String(task.order_id) }} className="relative z-10 inline-flex items-center gap-1 rounded-full bg-(--soft-2) px-1.5 py-0.5 hover:text-(--text)">
            <ShoppingCart className="size-3" aria-hidden="true" />№ {task.order_number}
          </Link>
        )}
        {task.note && <StickyNote className="size-3" aria-label={t('note')} />}
        {task.assignee_name && (
          <span className="ml-auto grid size-5 place-items-center rounded-full bg-(--accent) text-[10px] font-semibold text-(--on-accent)" title={task.assignee_name} aria-label={task.assignee_name}>
            {task.assignee_name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
    </article>
  )
}
