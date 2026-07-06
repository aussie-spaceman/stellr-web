import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { signedDownloadUrl } from '@/lib/community'

// GET ?itemId= — a short-lived signed URL for a lesson's saved recording, so the
// Course builder can play back what the recording webhook offloaded to storage.
export async function GET(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const itemId = new URL(req.url).searchParams.get('itemId')
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })

  const db = supabaseServer()
  const { data: item } = await db
    .from('training_items')
    .select('recording_path, recording_status')
    .eq('id', itemId)
    .maybeSingle()

  const status = (item?.recording_status as string | null) ?? 'none'
  if (status !== 'available' || !item?.recording_path) {
    return NextResponse.json({ status, url: null })
  }

  const url = await signedDownloadUrl(item.recording_path as string)
  return NextResponse.json({ status, url })
}
