import { useEffect, useRef, useState } from 'react'

// A search box whose text also lives in the address (?q=). Typing updates the address after a pause;
// a search arriving from elsewhere (the dock, Back) updates the box. The trim check keeps a space
// being typed between words.
export function useSearchBox(q: string, commit: (value: string | undefined) => void, ms = 250) {
  const [text, setText] = useState(q)
  const [seenQ, setSeenQ] = useState(q)
  if (q !== seenQ) {
    setSeenQ(q)
    if (q !== text.trim()) setText(q)
  }
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const onType = (value: string) => {
    setText(value)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => commit(value.trim() || undefined), ms)
  }
  return [text, onType] as const
}
