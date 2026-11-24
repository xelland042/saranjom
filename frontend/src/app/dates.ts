// Dates in our three languages, spelled out by hand.
import type { Lang } from './i18n'

// Names spelled out here: many browsers ship without Uzbek date data and would print "M11 17".
const MONTHS: Record<Lang, string[]> = {
  uz: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  'uz-Cyrl': ['январ', 'феврал', 'март', 'апрел', 'май', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
}
const WEEKDAYS: Record<Lang, string[]> = {
  uz: ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'],
  'uz-Cyrl': ['якшанба', 'душанба', 'сешанба', 'чоршанба', 'пайшанба', 'жума', 'шанба'],
  ru: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
}
// "17-noyabr, seshanba" in Uzbek, "17 ноября, вторник" in Russian
export function formatDate(d: Date, lang: Lang) {
  const day = lang === 'ru' ? `${d.getDate()} ` : `${d.getDate()}-`
  return `${day}${MONTHS[lang][d.getMonth()]}, ${WEEKDAYS[lang][d.getDay()]}`
}

// "2026-yil 17-noyabr" in Uzbek, "17 ноября 2026" in Russian
export function formatDay(d: Date, lang: Lang) {
  const m = MONTHS[lang][d.getMonth()]
  if (lang === 'ru') return `${d.getDate()} ${m} ${d.getFullYear()}`
  return `${d.getFullYear()}-${lang === 'uz' ? 'yil' : 'йил'} ${d.getDate()}-${m}`
}

// "2026-11-18" from the API as a local date (new Date() would read it as UTC midnight)
export function localDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// today in the browser's own time zone, in the API's form ("2026-11-19")
export function isoToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// whole days from an API date ("2026-11-01") to today; negative when it's still ahead
export const daysSince = (iso: string) => Math.round((localDate(isoToday()).getTime() - localDate(iso).getTime()) / 86_400_000)
