// The company's people and its roles (each a set of permissions the company picks).
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Permission } from './api'
import type { Key } from './i18n'

export type Person = {
  id: number
  name: string
  role_id: number
  role: string // the role's name
  active: boolean
  // how they log in: only for whoever manages staff
  phone: string | null
  email: string | null
  username: string | null
  created_at: string | null
}

// the owner role comes first and has every permission; people counts only active ones
export type Role = { id: number; name: string; owner: boolean; permissions: Permission[]; people: number }

// the role editor's rows: what an area's "sees" and "changes" boxes stand for. "staff" is not
// here: only the owner role manages people and roles
// (chip: the short name on a role's card)
export const AREAS: { label: Key; chip: Key; see: Permission | null; change: Permission | null }[] = [
  { label: 'customers', chip: 'customers', see: 'customers.read', change: 'customers.write' },
  { label: 'orders', chip: 'orders', see: 'orders.read', change: 'orders.write' },
  { label: 'permMoney', chip: 'money', see: 'money.read', change: 'money.write' },
  { label: 'permProducts', chip: 'products', see: 'products.read', change: 'products.write' },
  { label: 'permStock', chip: 'stock', see: 'stock.read', change: 'stock.write' },
  { label: 'permTasks', chip: 'tasks', see: 'tasks', change: 'tasks.columns' },
  { label: 'permDashboard', chip: 'home', see: 'dashboard', change: null },
  { label: 'permSettings', chip: 'vatRates', see: null, change: 'settings' },
]

// ticking "changes" ticks "sees" too, and unticking "sees" unticks "changes" (the server agrees)
export function togglePermission(perms: Set<Permission>, area: (typeof AREAS)[number], which: 'see' | 'change', on: boolean) {
  const next = new Set(perms)
  const p = area[which]!
  if (on) {
    next.add(p)
    if (which === 'change' && area.see) next.add(area.see)
  } else {
    next.delete(p)
    if (which === 'see' && area.change) next.delete(area.change)
  }
  return next
}

// everyone may read names and roles (task assignees); logins come only with the staff permission
export const staffQuery = queryOptions({ queryKey: ['staff'], queryFn: () => api<Person[]>('/staff'), staleTime: 60_000 })
export const rolesQuery = queryOptions({ queryKey: ['staff', 'roles'], queryFn: () => api<Role[]>('/roles') })

export function useStaffMutations() {
  const qc = useQueryClient()
  // a role change can change what the viewer may do, so "me" is refreshed too
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['staff'] }), qc.invalidateQueries({ queryKey: ['me'] })])
  return {
    add: useMutation({
      mutationFn: (f: { name: string; login: string; password: string; role_id: number }) => api<Person>('/staff', f),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, ...f }: { id: number; name?: string; role_id?: number; active?: boolean; password?: string }) => api<Person>(`/staff/${id}`, f, 'PATCH'),
      onSuccess: refresh,
    }),
    saveRole: useMutation({
      mutationFn: ({ id, ...f }: { id?: number; name?: string; permissions?: Permission[] }) => (id ? api<Role>(`/roles/${id}`, f, 'PATCH') : api<Role>('/roles', f)),
      onSuccess: refresh,
    }),
    removeRole: useMutation({ mutationFn: (id: number) => api<void>(`/roles/${id}`, undefined, 'DELETE'), onSuccess: refresh }),
  }
}
