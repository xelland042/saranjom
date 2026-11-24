// Tasks: types and server calls, cached by TanStack Query.
import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { Key } from './i18n'

// A board column, named and coloured by the company. Cards in a done column are finished tasks.
export type Stage = { id: number; name: string; color: StageColor; done: boolean; position: number; tasks: number }
export const STAGE_COLORS = ['gray', 'blue', 'accent', 'green', 'amber', 'red', 'violet', 'gold'] as const
export type StageColor = (typeof STAGE_COLORS)[number]
// the look's own colour tokens, so a column fits every look, light or dark
export const STAGE_VAR: Record<StageColor, string> = {
  gray: 'var(--text-3)',
  blue: 'var(--blue)',
  accent: 'var(--accent)',
  green: 'var(--green)',
  amber: 'var(--amber)',
  red: 'var(--red)',
  violet: 'var(--violet)',
  gold: 'var(--gold)',
}
export const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const
export type Priority = (typeof PRIORITIES)[number]
export const PRIORITY_KEY: Record<Priority, Key> = { urgent: 'prUrgent', high: 'prHigh', normal: 'prNormal', low: 'prLow' }
// colour tokens per priority; "normal" has none, so only what stands out is coloured
export const PRIORITY_COLOR: Record<Priority, string | null> = { urgent: 'var(--red)', high: 'var(--amber)', normal: null, low: 'var(--text-3)' }

export type Task = {
  id: number
  title: string
  note: string | null
  due_date: string | null
  due_time: string | null // "17:00:00"
  customer_id: number | null
  customer_name: string | null
  order_id: number | null
  order_number: number | null
  assignee_id: number | null
  assignee_name: string | null
  stage_id: number
  priority: Priority
  position: number
  done_at: string | null
  created_at: string
}
export type TaskFields = {
  title: string
  note: string
  due_date: string | null
  due_time: string | null
  customer_id: number | null
  order_id: number | null
  stage_id: number | null
  assignee_id: number | null
  priority: Priority
}
// open: not done, most urgent first; done: latest first; board: every column in card order
export type TaskView = 'open' | 'done' | 'board'
export type TaskFilters = { mine?: boolean; q?: string; priority?: Priority; due?: 'overdue' | 'today' | 'week'; customer_id?: number; order_id?: number }

// shortcut: one page of 500; add paging when a company keeps that many open tasks
export const taskList = (view: TaskView, filters: TaskFilters = {}) =>
  queryOptions({
    queryKey: ['tasks', 'list', { view, ...filters }],
    queryFn: () =>
      api<{ items: Task[]; total: number }>(
        `/tasks?${new URLSearchParams({
          view,
          limit: '500',
          ...Object.fromEntries(Object.entries(filters).flatMap(([k, v]) => (v === undefined || v === '' ? [] : [[k, String(v)]]))),
        })}`,
      ),
    placeholderData: keepPreviousData,
  })

// one task, fresh: what its view shows after a change made there
export const taskQuery = (id: number) => queryOptions({ queryKey: ['tasks', 'one', id], queryFn: () => api<Task>(`/tasks/${id}`) })

export const stagesQuery = queryOptions({ queryKey: ['tasks', 'stages'], queryFn: () => api<Stage[]>('/task-stages') })

// for the dock's count; refreshed every few minutes, so a task falling due shows up without a reload
export const taskSummary = queryOptions({
  queryKey: ['tasks', 'summary'],
  // the person's own: late or due today and assigned to them
  queryFn: () => api<{ overdue: number; today: number }>('/tasks/summary?mine=true'),
  refetchInterval: 5 * 60_000,
})

type Page = { items: Task[]; total: number }

export function useTaskMutations() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['tasks'] })
  return {
    save: useMutation({
      mutationFn: ({ id, ...f }: Partial<TaskFields> & { id?: number }) => (id ? api<Task>(`/tasks/${id}`, f, 'PATCH') : api<Task>('/tasks', f)),
      onSuccess: refresh,
    }),
    setDone: useMutation({
      mutationFn: ({ id, done }: { id: number; done: boolean }) => api<Task>(`/tasks/${id}`, { done }, 'PATCH'),
      // not awaited: ticking the last task of a group removes the group, and the caller's
      // onSuccess (the toast with undo) would be dropped with it if it waited for the refetch
      onSuccess: () => void refresh(),
    }),
    // a card dragged on the board: shown in its new place at once, put back if the server refuses
    move: useMutation({
      mutationFn: ({ id, stage, position }: { id: number; stage: Stage; position: number }) => api<Task>(`/tasks/${id}`, { stage_id: stage.id, position }, 'PATCH'),
      onMutate: async ({ id, stage, position }) => {
        await qc.cancelQueries({ queryKey: ['tasks', 'list'] })
        const before = qc.getQueriesData<Page>({ queryKey: ['tasks', 'list'] })
        for (const [key, page] of before) {
          if (!page) continue
          const items = page.items.map((t) => (t.id === id ? { ...t, stage_id: stage.id, position, done_at: stage.done ? (t.done_at ?? new Date().toISOString()) : null } : t))
          qc.setQueryData<Page>(key, { ...page, items: items.sort((a, b) => a.position - b.position || a.id - b.id) })
        }
        return { before }
      },
      onError: (_e, _v, ctx) => ctx?.before.forEach(([key, page]) => qc.setQueryData(key, page)),
      onSettled: () => void refresh(),
    }),
    remove: useMutation({ mutationFn: (id: number) => api<void>(`/tasks/${id}`, undefined, 'DELETE'), onSuccess: refresh }),
    // the board's columns: every change can move cards and finish or reopen tasks
    saveStage: useMutation({
      mutationFn: ({ id, ...f }: { id?: number; name?: string; color?: StageColor; done?: boolean; position?: number }) =>
        id ? api<Stage>(`/task-stages/${id}`, f, 'PATCH') : api<Stage>('/task-stages', f),
      onSuccess: refresh,
    }),
    removeStage: useMutation({
      mutationFn: ({ id, moveTo }: { id: number; moveTo?: number }) => api<void>(`/task-stages/${id}${moveTo ? `?move_to=${moveTo}` : ''}`, undefined, 'DELETE'),
      onSuccess: refresh,
    }),
  }
}
