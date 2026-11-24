import { describe, expect, it } from 'vitest'
import { ApiError, invalidFields } from './api'

describe('invalidFields', () => {
  it('names the fields a 422 complained about', () => {
    const e = new ApiError(422, { detail: [{ loc: ['body', 'inn'] }, { loc: ['body', 'lines'] }] })
    expect([...invalidFields(e)]).toEqual(['inn', 'lines'])
  })
  it('nothing for other errors', () => {
    expect(invalidFields(new ApiError(409, { detail: 'Already exists' })).size).toBe(0)
    expect(invalidFields(new ApiError(422, { detail: 'not a list' })).size).toBe(0)
    expect(invalidFields(new Error('offline')).size).toBe(0)
  })
})
