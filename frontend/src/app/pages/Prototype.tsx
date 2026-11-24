// The Glass prototype from src/playground, with its own fake data and its own look in the address
// (/prototype#light/home). Reference only: real screens are built in src/app.
import { useEffect, useState } from 'react'
import Spatial from '@/playground/Spatial'
import { lookFromHash } from '@/playground/looks'

export default function Prototype() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return <Spatial look={lookFromHash(hash)} />
}
