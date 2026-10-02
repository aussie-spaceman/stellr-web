import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { previewFor, resolveSession } from '@/lib/esign/native/flow'
import { invalidLink, NO_STORE, sessionCookie, throttle } from '@/lib/esign/native/http'

// GET /api/sign/document — the document as it stands for this signer: the
// agreement with their pre-filled details and anything earlier signers
// entered. Served inline for reading; never cached.

export const maxDuration = 30

export async function GET(req: Request) {
  const limited = throttle(req, 'document', 20)
  if (limited) return limited
  const db = supabaseServer()
  const ctx = await resolveSession(db, await sessionCookie(), 'act')
  if (!ctx) return invalidLink()

  const pdf = await previewFor(db, ctx)
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      ...NO_STORE,
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="agreement-for-review.pdf"',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
