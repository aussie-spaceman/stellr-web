import { describe, it, expect } from 'vitest'
import { supabaseServerTyped } from './supabase'

// deep review QUAL-4: supabaseServerTyped() applies the Database generic so
// column/enum drift is a compile error on the tables the generic covers.
describe('supabaseServerTyped (QUAL-4)', () => {
  it('is exported', () => {
    expect(typeof supabaseServerTyped).toBe('function')
  })
})

// Compile-time only — never executed. The @ts-expect-error directives below are
// checked by `tsc --noEmit` (part of the gate): if the client were NOT typed by
// the Database generic, the writes would be accepted, the directives would be
// "unused", and tsc would fail. So this doubles as a regression guard that the
// generic stays applied — new drift (a wrong enum value, a column that does not
// exist) is caught before runtime.
async function _qual4DriftIsCaught(db: ReturnType<typeof supabaseServerTyped>) {
  // A real table + column compiles.
  await db.from('registrations').select('id')
  // @ts-expect-error QUAL-4: a value outside the status union is rejected.
  await db.from('registrations').update({ status: 'not_a_status' }).eq('id', 'x')
  // @ts-expect-error QUAL-4: a write to a column that does not exist is rejected.
  await db.from('registrations').update({ no_such_column: 1 }).eq('id', 'x')
}
void _qual4DriftIsCaught
