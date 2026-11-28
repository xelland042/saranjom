import type { ReactNode } from 'react'
import { Outlet } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import Auth from './Auth'
import Backdrop from './Backdrop'
import Shell from './Shell'
import { usePrefs } from './prefs'
import { useQuery } from '@tanstack/react-query'
import { demoQuery, useMe } from './session'

// Decides between the login screen and the app, for every address, including unknown ones.
export default function Gate({ children = <Outlet /> }: { children?: ReactNode }) {
  const me = useMe()
  // asked alongside, so the login card is drawn once, with or without its demo button
  const demo = useQuery(demoQuery)
  const { look, t } = usePrefs()
  if (me.isPending) return null
  if (me.isError) {
    // the server is unreachable: say so, with a retry, rather than showing a login that can't work
    return (
      <div className="sp grid min-h-screen place-items-center p-6" data-look={look}>
        <Backdrop />
        <div className="glass grid justify-items-center gap-4 p-8 text-center">
          <p>{t('offline')}</p>
          <Button onClick={() => me.refetch()}>{t('retry')}</Button>
        </div>
      </div>
    )
  }
  if (!me.data) return demo.isPending ? null : <Auth demo={demo.data === true} />
  return (
    <Shell me={me.data}>{children}</Shell>
  )
}

