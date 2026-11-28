// Who is logged in, shared through TanStack Query so every part of the app sees the same answer.
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type Me, type Permission } from './api'

export const meQuery = queryOptions({
  queryKey: ['me'],
  // null means logged out; any other failure (server down) stays an error, shown with a retry
  queryFn: async (): Promise<Me | null> => {
    try {
      return await api<Me>('/auth/me')
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null
      throw e
    }
  },
  staleTime: Infinity,
  retry: false,
})

export const useMe = () => useQuery(meQuery)

// Whether this server has a demo company anyone may look around (the login screen's button).
export const demoQuery = queryOptions({
  queryKey: ['demo'],
  queryFn: () => api<{ available: boolean }>('/auth/demo').then((d) => d.available).catch(() => false),
  staleTime: Infinity,
  retry: false,
})

export function useLogout() {
  const qc = useQueryClient()
  return async () => {
    await api('/auth/logout', {}).catch(() => {})
    // Mark logged out first: the screen is watching this entry, so it switches to the login now.
    // (Clearing the whole cache first would detach the screen from it and leave the old user showing.)
    qc.setQueryData(meQuery.queryKey, null)
    // then forget everything else that belonged to this user
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== meQuery.queryKey[0] })
  }
}

// What the logged-in person's role allows: screens hide what it doesn't (the server refuses it anyway)
export function useCan() {
  const me = useMe().data
  return (p: Permission) => !!me?.permissions.includes(p)
}
