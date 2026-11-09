// A corrected guardian email, for the events admin guardian route (S5 C17). On its own so that
// the routes that use lib/events/admin-records.ts do not load field encryption with it.
import type { SupabaseClient } from '@supabase/supabase-js'
import { shadowSyncFields } from '@/lib/field-crypto-shadow'

/**
 * Save a corrected guardian email. The member record carries the same contact for future
 * events; it changes only while it still holds the old value, never over a newer one.
 * Answers with the participant write's error, and writes nothing more if there is one.
 */
export async function saveGuardianEmail(
  db: SupabaseClient,
  c: { participantId: string; memberId: string | null; previous: string | null; email: string },
): Promise<{ error: unknown }> {
  const { error } = await db.from('participants').update({ emergency_contact_email: c.email }).eq('id', c.participantId)
  if (error) return { error }
  if (c.memberId) {
    const memberUpdate = db.from('members').update({ ec_email: c.email }).eq('id', c.memberId)
    await (c.previous ? memberUpdate.eq('ec_email', c.previous) : memberUpdate.is('ec_email', null))
  }
  // S4 field encryption: inert unless FIELD_CRYPTO_MODE=shadow; never fails this write.
  shadowSyncFields('participants', [c.participantId])
  shadowSyncFields('members', [c.memberId])
  return { error: null }
}
