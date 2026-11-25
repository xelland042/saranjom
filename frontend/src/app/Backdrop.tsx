// What sits behind every screen: the wallpaper for Glass and Light, a dot grid for the Plain looks,
// and two soft glows. Shared by the login screen and the app shell.
import { Scene, Wallpaper } from '@/playground/parts'
import { usePrefs } from './prefs'

export default function Backdrop() {
  const { look } = usePrefs()
  return (
    <>
      {look === 'glass' && <Scene />}
      {(look === 'glass' || look === 'light') && <Wallpaper look={look} />}
      {look === 'glass' && <div className="sp-shade" aria-hidden="true" />}
      {(look === 'plain' || look === 'plain-dark') && <div className="auth-grid" aria-hidden="true" />}
      <div className="auth-glow auth-glow-a" aria-hidden="true" />
      <div className="auth-glow auth-glow-b" aria-hidden="true" />
    </>
  )
}
