import { describe, it, expect } from 'vitest'
import { accountName } from './account-name'
import { settleRegistrantName, type GroupBody } from './group/parse'

describe('accountName', () => {
  it('is the account’s name, trimmed, when both halves are on file', () => {
    expect(accountName({ first_name: ' Account ', last_name: 'Holder ' })).toEqual({ first_name: 'Account', last_name: 'Holder' })
  })

  it('is null for no member, or an account missing either half', () => {
    expect(accountName(null)).toBeNull()
    expect(accountName(undefined)).toBeNull()
    expect(accountName({ first_name: 'Account', last_name: null })).toBeNull()
    expect(accountName({ first_name: '  ', last_name: 'Holder' })).toBeNull()
    expect(accountName({})).toBeNull()
  })
})

describe('settleRegistrantName', () => {
  const body = (teacher: Record<string, unknown> | null) => ({ teacher } as unknown as GroupBody)

  it('replaces whatever was sent with the account’s name', () => {
    const b = body({ first_name: 'Typed', last_name: 'Othername', email: 'x@example.com' })
    settleRegistrantName(b, { first_name: 'Account', last_name: 'Holder' })
    expect(b.teacher).toMatchObject({ first_name: 'Account', last_name: 'Holder', email: 'x@example.com' })
  })

  it('leaves the typed name with no account name, and a missing registrant alone', () => {
    const b = body({ first_name: 'Typed', last_name: 'Othername' })
    settleRegistrantName(b, null)
    expect(b.teacher).toMatchObject({ first_name: 'Typed', last_name: 'Othername' })
    const none = body(null)
    settleRegistrantName(none, { first_name: 'Account', last_name: 'Holder' })
    expect(none.teacher).toBeNull()
  })
})
