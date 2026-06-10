import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { RESOURCES_BUCKET } from '@/lib/community'

// Recording offload (FR-COM-11/12).
//
// JaaS retains cloud recordings for only ~24h, so the provider's recording-ready
// webhook must pull the file into private Supabase Storage (US region) promptly.
// This handler is provider-agnostic at the seam: it expects { sessionId, recordingUrl }.
// The thin provider-specific adapter (signature verification + payload mapping)
// is added when the JaaS/Zoom account is live.
//
// SECURITY TODO: verify the provider signature before trusting the payload.
export async function POST(req: Request) {
  // Shared-secret guard until per-provider signature verification is wired.
  const secret = process.env.RECORDING_WEBHOOK_SECRET
  if (secret && req.headers.get('x-webhook-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { sessionId, recordingUrl } = await req.json().catch(() => ({}))
  if (!sessionId || !recordingUrl) {
    return NextResponse.json({ error: 'sessionId and recordingUrl required' }, { status: 400 })
  }

  const db = supabaseServer()
  await db.from('sessions').update({ recording_status: 'pending' }).eq('id', sessionId)

  try {
    const res = await fetch(recordingUrl)
    if (!res.ok) throw new Error(`fetch ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const path = `recordings/${sessionId}-${Date.now()}.mp4`

    const { error: upErr } = await db.storage
      .from(RESOURCES_BUCKET)
      .upload(path, buf, { contentType: 'video/mp4', upsert: true })
    if (upErr) throw upErr

    await db
      .from('sessions')
      .update({ recording_path: path, recording_status: 'available' })
      .eq('id', sessionId)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[recording] offload failed:', e)
    await db.from('sessions').update({ recording_status: 'none' }).eq('id', sessionId)
    return NextResponse.json({ error: 'Offload failed' }, { status: 500 })
  }
}
