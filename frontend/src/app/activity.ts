// The history: what happened to a record or with a customer, by whom and when; and notes.
import { infiniteQueryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export type Activity = {
  id: number
  entity: 'customer' | 'order' | 'payment' | 'task' | 'product' | 'stock_document' | 'return'
  entity_id: number
  action: string
  customer_id: number | null
  user_id: number | null
  user_name: string | null
  text: string | null
  // what's needed to show it: number, total, currency, title, changes {field: [old, new]}...
  data: Record<string, unknown>
  created_at: string
  mine: boolean
}
export type Scope = { customerId: number } | { entity: Activity['entity']; entityId: number }

const PAGE = 30

export const activityFeed = (scope: Scope) =>
  infiniteQueryOptions({
    queryKey: ['activity', scope],
    queryFn: ({ pageParam }) =>
      api<Activity[]>(
        `/activity?${new URLSearchParams({
          limit: String(PAGE),
          ...('customerId' in scope ? { customer_id: String(scope.customerId) } : { entity: scope.entity, entity_id: String(scope.entityId) }),
          ...(pageParam ? { before: String(pageParam) } : {}),
        })}`,
      ),
    initialPageParam: 0,
    // a full page means there may be older ones: continue before the last one shown
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].id : undefined),
  })

export function useNotes(customerId: number) {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['activity'] })
  return {
    add: useMutation({ mutationFn: (text: string) => api<Activity>(`/customers/${customerId}/notes`, { text }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: number) => api<void>(`/activity/${id}`, undefined, 'DELETE'), onSuccess: refresh }),
  }
}
