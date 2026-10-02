import { supabaseServer } from '@/lib/supabase'
import { resolveSession } from '@/lib/esign/native/flow'
import { verifyToken } from '@/lib/esign/native/tokens'
import { STORED_RECORD_COLUMNS, loadSignedRecord, logRecordAccess, type StoredRecordRow } from '@/lib/esign/archive'
import { invalidLink, json, readJson, sameOrigin, sessionCookie, throttle } from '@/lib/esign/native/http'

// POST /api/sign/copy — a signer's own copy of the signed agreement, as a
// short-lived link. Reached two ways: straight after signing (the session
// cookie), or later from the completion email (a download token, read from
// the URL fragment by /sign/copy). Parents have no account, so this is how
// they keep the record of what they signed.

export async function POST(req: Request) {
  const limited = throttle(req, 'copy', 10)
  if (limited) return limited
  if (!sameOrigin(req)) return json({ error: 'Forbidden' }, 403)
  const db = supabaseServer()

  const body = await readJson<{ token?: unknown }>(req)
  let recipientId: string | null = null
  let envelopeRow: string | null = null

  if (typeof body?.token === 'string') {
    const verified = verifyToken(body.token, 'download')
    if (!verified) return invalidLink()
    const { data: r } = await db
      .from('docusign_envelope_recipients')
      .select('id, envelope_row, status, token_version')
      .eq('id', verified.recipientId)
      .maybeSingle()
    // The download token is minted at completion; a later reissue or void
    // bumps the version and kills it.
    if (!r || r.status !== 'completed' || (r.token_version as number) !== verified.version) return invalidLink()
    recipientId = r.id as string
    envelopeRow = r.envelope_row as string
  } else {
    const ctx = await resolveSession(db, await sessionCookie(), 'read')
    if (!ctx || ctx.recipient.status !== 'completed') return invalidLink()
    recipientId = ctx.recipient.id
    envelopeRow = ctx.envelope.id
  }

  const { data: row } = await db
    .from('docusign_envelopes')
    .select(STORED_RECORD_COLUMNS)
    .eq('id', envelopeRow)
    .eq('provider', 'native')
    .maybeSingle()
  const record = row as StoredRecordRow | null
  if (!record || record.status !== 'completed' || record.restricted_at) {
    return json({ state: 'pending', message: 'Your copy is being prepared. Try again in a minute.' }, 409)
  }

  const signed = await loadSignedRecord(db, record, 'pdf')
  if (signed.kind !== 'url') return json({ error: 'Your copy could not be retrieved. Try again shortly.' }, 409)
  await logRecordAccess(db, { envelopeRow: record.id, action: 'download', actorType: 'signer', actorId: recipientId })
  return json({ url: signed.url, filename: signed.filename })
}
