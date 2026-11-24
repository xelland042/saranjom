// Tasks as a board (To do, In progress, Done: drag cards between columns) or as a list grouped
// into late, today, later and undated; done ones on their own tab. A strip of counts on top, and
// search, priority and due filters. The view and every filter live in the address.
import { useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { CheckSquare, Columns3, List, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { daysSince } from '../../dates'
import type { Key } from '../../i18n'
import { EmptyState, PageHeader } from '../../Page'
import { usePrefs } from '../../prefs'
import { PRIORITIES, PRIORITY_COLOR, PRIORITY_KEY, stagesQuery, taskList, type Task, type TaskFilters } from '../../tasks'
import StatStrip, { type Stat } from '../../StatStrip'
import { useSearchBox } from '../../useSearchBox'
import { Tile } from '../stock/Balances'
import Board from './Board'
import TaskDialog from './TaskDialog'
import TaskRows from './TaskRows'
import { Switch } from '@/components/ui/switch'

const route = getRouteApi('/app/tasks')

const GROUPS: { key: Key; test: (t: Task) => boolean; red?: boolean }[] = [
  { key: 'groupLate', test: (t) => !!t.due_date && daysSince(t.due_date) > 0, red: true },
  { key: 'today', test: (t) => !!t.due_date && daysSince(t.due_date) === 0 },
  { key: 'groupLater', test: (t) => !!t.due_date && daysSince(t.due_date) < 0 },
  { key: 'groupUndated', test: (t) => !t.due_date },
]

export default function Tasks() {
  const { t } = usePrefs()
  const { view = 'board', q = '', priority, due, mine } = route.useSearch()
  const navigate = route.useNavigate()
  const set = (patch: Record<string, unknown>) => navigate({ search: (s) => ({ ...s, ...patch }), replace: true })
  const [text, onType] = useSearchBox(q, (v) => set({ q: v }))
  const filters: TaskFilters = { q, priority, due, mine }
  const list = useQuery(taskList(view === 'board' ? 'board' : view === 'done' ? 'done' : 'open', filters))
  // the counts come from the whole board, whatever the filters
  const all = useQuery(taskList('board')).data?.items ?? []
  const stages = useQuery(stagesQuery).data
  // closing keeps the task, so the dialog's text doesn't change while it fades out
  const [dialog, setDialog] = useState<{ open: boolean; task?: Task }>({ open: false })
  const tasks = list.data?.items ?? []
  const open = (task?: Task) => setDialog({ open: true, task })
  const filtered = !!(q || priority || due || mine)

  const openTasks = all.filter((x) => !x.done_at)
  const late = openTasks.filter((x) => x.due_date && daysSince(x.due_date) > 0).length
  const counts: Stat[] = [
    { label: t('tasksOpen'), value: openTasks.length },
    { label: t('groupLate'), value: late, tone: late ? 'red' : undefined, link: { to: '/tasks', search: { due: 'overdue' } } },
    { label: t('today'), value: openTasks.filter((x) => x.due_date && daysSince(x.due_date) === 0).length, link: { to: '/tasks', search: { due: 'today' } } },
    { label: t('doneThisWeek'), value: all.filter((x) => x.done_at && daysSince(x.done_at.slice(0, 10)) < 7).length },
  ]

  let body
  if (list.isPending || !stages) {
    body = (
      <div className="grid gap-4 lg:grid-cols-3" aria-busy="true">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-48 rounded-(--radius)" />
        ))}
      </div>
    )
  } else if (list.isError) {
    body = (
      <div className="glass grid justify-items-center gap-3 px-6 py-14 text-center">
        <p>{t('offline')}</p>
        <Button variant="secondary" onClick={() => list.refetch()}>{t('retry')}</Button>
      </div>
    )
  } else if (view === 'board') {
    body = filtered && tasks.length === 0 ? <Nothing /> : <Board stages={stages} tasks={tasks} onOpen={open} />
  } else if (tasks.length === 0) {
    body = (
      <section className="glass">
        {filtered ? (
          <Nothing bare />
        ) : view === 'done' ? (
          <EmptyState bare icon={<Tile icon={CheckSquare} color="var(--blue)" />} title={t('noDoneTasks')} text={t('noDoneTasksText')} />
        ) : (
          <EmptyState
            bare
            icon={<Tile icon={CheckSquare} color="var(--blue)" />}
            title={t('noTasks')}
            text={t('noTasksText')}
            action={
              <Button onClick={() => open()}>
                <Plus aria-hidden="true" /> {t('newTask')}
              </Button>
            }
          />
        )}
      </section>
    )
  } else if (view === 'done') {
    body = (
      <section className="glass px-4 py-2">
        <TaskRows tasks={tasks} onOpen={open} />
      </section>
    )
  } else {
    body = (
      <section className="glass grid gap-2 px-4 py-3">
        {GROUPS.map((g) => {
          const items = tasks.filter(g.test)
          if (!items.length) return null
          return (
            <section key={g.key} aria-label={t(g.key)}>
              <h2 className={`pt-2 text-xs font-semibold tracking-wide uppercase ${g.red ? 'text-red' : 'text-muted-foreground'}`}>
                {t(g.key)} · {items.length}
              </h2>
              <TaskRows tasks={items} onOpen={open} />
            </section>
          )
        })}
      </section>
    )
  }

  return (
    <>
      <PageHeader
        title={t('tasks')}
        description={t('tasksIntro')}
        actions={
          <Button onClick={() => open()}>
            <Plus aria-hidden="true" /> {t('newTask')}
          </Button>
        }
      />
      <StatStrip stats={counts} />
      <div className="rise mb-4 flex flex-wrap items-center gap-2" style={{ '--i': 2 } as CSSProperties}>
        <Tabs value={view} onValueChange={(v) => set({ view: v === 'board' ? undefined : v })}>
          <TabsList>
            <TabsTrigger value="board">
              <Columns3 aria-hidden="true" /> {t('viewBoard')}
            </TabsTrigger>
            <TabsTrigger value="list">
              <List aria-hidden="true" /> {t('viewList')}
            </TabsTrigger>
            <TabsTrigger value="done">{t('tasksDone')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={text} onChange={(e) => onType(e.target.value)} placeholder={t('searchTasks')} aria-label={t('searchTasks')} className="pl-10" />
        </div>
        <Select value={priority ?? 'any'} onValueChange={(v) => set({ priority: v === 'any' ? undefined : v })}>
          <SelectTrigger className="w-44" aria-label={t('priority')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t('anyPriority')}</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                <span className="size-2 rounded-full" style={{ background: PRIORITY_COLOR[p] ?? 'var(--soft-2)' }} aria-hidden="true" />
                {t(PRIORITY_KEY[p])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={!!mine} onCheckedChange={(v) => set({ mine: v || undefined })} />
          {t('myTasks')}
        </label>
        <Select value={due ?? 'any'} onValueChange={(v) => set({ due: v === 'any' ? undefined : v })}>
          <SelectTrigger className="w-44" aria-label={t('dueOn')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">{t('anyDue')}</SelectItem>
            <SelectItem value="overdue">{t('groupLate')}</SelectItem>
            <SelectItem value="today">{t('today')}</SelectItem>
            <SelectItem value="week">{t('dueThisWeek')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="rise" style={{ '--i': 3 } as CSSProperties} data-stale={list.isPlaceholderData || undefined}>
        {body}
      </div>
      <TaskDialog open={dialog.open} task={dialog.task} onOpenChange={(o) => setDialog({ ...dialog, open: o })} />
    </>
  )
}

function Nothing({ bare = false }: { bare?: boolean }) {
  const { t } = usePrefs()
  const state = <EmptyState bare icon={<Tile icon={Search} color="var(--violet)" />} title={t('nothingFound')} text={t('nothingFoundText')} />
  return bare ? state : <section className="glass">{state}</section>
}

