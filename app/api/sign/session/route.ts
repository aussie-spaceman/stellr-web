import { supabaseServer } from '@/lib/supabase'
import { openLink } from '@/lib/esign/native/flow'
import { invalidLink, json, readJson, sameOrigin, setSessionCookie, throttle } from '@/lib/esign/native/http'

// POST /api/sign/session — exchange the emailed signing link for a session.
//
// The token arrives in the request body (the page read it from the URL
// fragment, which browsers never send to a server, never log, and never pass
// on as a referrer). It is exchanged once for a 30-minute httpOnly cookie, and
// the page then drops it from the address bar.
//
// For a document about a child the signer first confirms the child's year of
// birth, so a link sent to a mistyped address shows a stranger nothing.

export async function POST(req: Request) {
  const limited = throttle(req, 'session', 20)
  if (limited) return limited
  if (!sameOrigin(req)) return json({ error: 'Forbidden' }, 403)

  const body = await readJson<{ token?: unknown; birthYear?: unknown }>(req)
  if (!body || typeof body.token !== 'string') return invalidLink()
  const birthYear = typeof body.birthYear === 'string' ? body.birthYear.slice(0, 4) : null

  const state = await openLink(supabaseServer(), body.token, { birthYear })
  switch (state.kind) {
    case 'invalid':
      return invalidLink()
    case 'verify':
      return json({ state: 'verify', question: state.question, documentLabel: state.documentLabel, retry: !!birthYear })
    case 'not_yet':
      return json({ state: 'not_yet' })
    case 'already_signed':
      return json({ state: 'already_signed', completed: state.completed })
    case 'ready':
      return setSessionCookie(json({ state: 'ready' }), state.session)
  }
}
