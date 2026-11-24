// Calls to our backend. The session is an HttpOnly cookie, so the browser sends it on its own.
export class ApiError extends Error {
  status: number
  // the parsed JSON error body, when there is one: {detail: ...}
  body: { detail?: unknown; [k: string]: unknown } | null
  constructor(status: number, body: ApiError['body']) {
    super(`API error ${status}`)
    this.status = status
    this.body = body
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

// A body without a method means POST.
export async function api<T>(path: string, body?: unknown, method?: Method): Promise<T> {
  const m = method ?? (body !== undefined ? 'POST' : 'GET')
  const r = await fetch(`/api/v1${path}`, {
    method: m,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => null))
  return r.status === 204 ? (undefined as T) : r.json()
}

// The fields a 422 complained about, from FastAPI's [{loc: ['body', 'inn'], ...}].
export function invalidFields(e: unknown): Set<string> {
  const detail = e instanceof ApiError && e.status === 422 ? e.body?.detail : null
  if (!Array.isArray(detail)) return new Set()
  return new Set(detail.map((d: { loc?: unknown[] }) => String(d.loc?.[1] ?? '')))
}

export type Permission =
  | 'customers.read'
  | 'customers.write'
  | 'orders.read'
  | 'orders.write'
  | 'money.read'
  | 'money.write'
  | 'products.read'
  | 'products.write'
  | 'stock.read'
  | 'stock.write'
  | 'tasks'
  | 'tasks.columns'
  | 'dashboard'
  | 'settings'
  | 'staff'

export type Me = {
  id: number
  name: string
  phone: string | null
  email: string | null
  username: string | null
  role: string // its name, which the company chose
  owner: boolean
  permissions: Permission[] // what to offer; the server checks every request anyway
  company_id: number
  company_name: string
  company_inn: string | null // the 1C export needs it
  company_bank_account: string | null // and this, for bank payments
  company_onec_name: string | null // its name in 1C, if not company_name
}
