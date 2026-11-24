import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import './index.css'
import { ApiError } from './app/api'
import { PrefsProvider } from './app/PrefsProvider'
import { router } from './app/router'
import { meQuery } from './app/session'

// A 401 anywhere means the session ended (expired, or logged out in another tab): show the login.
const onError = (e: unknown) => {
  if (e instanceof ApiError && e.status === 401) queryClient.setQueryData(meQuery.queryKey, null)
}
const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({
    onError,
    // every change can add to a history and move the overview's numbers: refresh both
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activity'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  }),
  defaultOptions: {
    // retry only what may pass next time (network, server errors), never a 4xx answer
    queries: { retry: (n, e) => n < 2 && !(e instanceof ApiError && e.status < 500) },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PrefsProvider>
        <RouterProvider router={router} />
      </PrefsProvider>
    </QueryClientProvider>
  </StrictMode>,
)
