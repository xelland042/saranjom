import { describe, expect, it } from 'vitest'
import { T } from './i18n'

const entries = Object.entries(T) as [string, readonly [string, string, string]][]

describe('translations', () => {
  it('every text exists in all three languages', () => {
    const empty = entries.filter(([, texts]) => texts.some((s) => !s.trim())).map(([k]) => k)
    expect(empty).toEqual([])
  })
  it('placeholders are the same in every language', () => {
    const marks = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join()
    const differ = entries.filter(([, [uz, cyr, ru]]) => marks(uz) !== marks(cyr) || marks(uz) !== marks(ru)).map(([k]) => k)
    expect(differ).toEqual([])
  })
  it('no Latin Uzbek in the Cyrillic and Russian texts', () => {
    // oʻ and gʻ are Latin-only: one in a Cyrillic text means it was pasted into the wrong slot
    const wrong = entries.filter(([, [, cyr, ru]]) => /ʻ/.test(cyr) || /ʻ/.test(ru)).map(([k]) => k)
    expect(wrong).toEqual([])
  })
  it('no Uzbek Cyrillic letters in the Latin texts', () => {
    const wrong = entries.filter(([, [uz]]) => /[ўқғҳЎҚҒҲ]/.test(uz)).map(([k]) => k)
    expect(wrong).toEqual([])
  })
})
