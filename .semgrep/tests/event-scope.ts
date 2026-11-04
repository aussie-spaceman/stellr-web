// Semgrep rule test for .semgrep/event-scope.yml. Never imported or compiled:
// .semgrep/ is outside tsconfig's include and excluded from scans (.semgrepignore).
declare const db: any
declare const slug: string
declare const id: string

export async function examples() {
  // ruleid: stellr-unscoped-event-table
  await db.from('registrations').select('*')

  // ruleid: stellr-unscoped-event-table
  await db.from('registrations').select('*').eq('id', id)

  // ruleid: stellr-unscoped-event-table
  await db.from('team_profiles').update({ name: 'x' }).eq('member_id', id)

  // ruleid: stellr-unscoped-event-table
  await db.from('store_orders').delete().eq('id', id)

  // ok: stellr-unscoped-event-table
  await db.from('registrations').select('*').eq('event_slug', slug)

  // ok: stellr-unscoped-event-table
  await db.from('registrations').select('*').eq('event_slug', slug).eq('id', id).single()

  // ok: stellr-unscoped-event-table
  await db.from('event_settings').select('*').in('event_slug', [slug])

  // ok: stellr-unscoped-event-table
  await db.from('credentials').select('*').match({ member_id: id, event_slug: slug })

  // ok: stellr-unscoped-event-table
  await db.from('registrations').insert({ event_slug: slug, member_id: id })

  // ok: stellr-unscoped-event-table
  await db.from('event_settings').upsert({ event_slug: slug })

  // ok: stellr-unscoped-event-table
  await db.from('members').select('*')

  // ok: stellr-unscoped-event-table
  await db.storage.from('registrations-bucket').list()
}
