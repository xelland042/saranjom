// The dashboard's numbers, reused by the list pages' stat strips (one cached request).
import { useQuery } from '@tanstack/react-query'
import { dashboardQuery } from './dashboard'
import { isoToday } from './dates'
import { useCan } from './session'

export function useOverview() {
  // the overview is for roles that have it; the rest see their lists without the strip
  const d = useQuery({ ...dashboardQuery, enabled: useCan()('dashboard') }).data
  const today = isoToday()
  const month = { from: `${today.slice(0, 8)}01`, to: today }
  const debt = d?.debts.totals.find((x) => x.currency === d.currency) ?? d?.debts.totals[0]
  return { d, today, month, debt }
}
