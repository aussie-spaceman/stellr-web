import { supabaseServer } from '@/lib/supabase'
import { openLink } from '@/lib/esign/native/flow'
import { clearSessionCookie, invalidLink, json, readJson, sameOrigin, setSessionCookie, throttle } from '@/lib/esign/native/http'

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

  // deep review DSES-N1: each link gets its own per-recipient session cookie
  // (ES-1), so opening a second link in the same browser does NOT end the first
  // — a parent with two children keeps a separate session per child, and an
  // action in one tab can never land on the other child's form. (Earlier code
  // kept a single cookie and overwrote it; do not restore that.) The
  // clearSessionCookie calls below only wipe the legacy unscoped cookie.
  const state = await openLink(supabaseServer(), body.token, { birthYear })
  switch (state.kind) {
    case 'invalid':
      return clearSessionCookie(invalidLink())
    case 'verify':
      return clearSessionCookie(json({ state: 'verify', question: state.question, documentLabel: state.documentLabel, aboutSigner: state.aboutSigner, retry: !!birthYear }))
    case 'not_yet':
      return clearSessionCookie(json({ state: 'not_yet' }))
    case 'already_signed':
      return clearSessionCookie(json({ state: 'already_signed', completed: state.completed }))
    case 'ready':
      // deep review ES-1: scope the session cookie to this recipient and hand
      // the tab its ref, so a second link opened in another tab keeps its own
      // session instead of overwriting this one.
      return setSessionCookie(json({ state: 'ready', ref: state.recipient.id }), state.session, state.recipient.id)
  }
}
