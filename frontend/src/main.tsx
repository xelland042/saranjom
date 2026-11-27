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
    // every change can add to a history, move the overview's numbers, the reports and the money in
    // the cash box or the bank (a payment in, a payment to a supplier): refresh them
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activity'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['cash'] })
      queryClient.invalidateQueries({ queryKey: ['reports'] })
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
