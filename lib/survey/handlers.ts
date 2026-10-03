/**
 * Route handlers shared by the token API (/api/survey/[token]) and the member
 * API (/api/members/surveys/[invitationId]).
 */
import { NextResponse } from 'next/server'
import { resolveSession, type Ref } from './http'
import { clientView, openSession, runtimeOptions, saveDraft, submitResponse } from './access'

async function body(req: Request): Promise<Record<string, unknown>> {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  return b && typeof b === 'object' ? b : {}
}

/** GET: open (records the open) and return what the renderer needs. */
export async function handleOpen(req: Request, ref: Ref) {
  const r = await resolveSession(req, ref, { write: false })
  if ('error' in r) return r.error
  const { db, session, from } = r
  if (session.state !== 'open' && !session.response) {
    return NextResponse.json({ state: session.state })
  }
  const resp = session.state === 'open' ? await openSession(db, session, from) : session.response!
  return NextResponse.json(clientView(session, resp, await runtimeOptions(db)))
}

/** PATCH: autosave the draft and current page. */
export async function handleSave(req: Request, ref: Ref) {
  const r = await resolveSession(req, ref, { write: true })
  if ('error' in r) return r.error
  const { db, session, from } = r
  if (!session.response && session.state === 'open') session.response = await openSession(db, session, from)
  const b = await body(req)
  const res = await saveDraft(db, session, { answers: b.answers, page: b.page })
  if (!res.ok) return NextResponse.json({ error: res.error, fieldErrors: res.fieldErrors }, { status: res.status })
  return NextResponse.json({ savedAt: res.savedAt })
}

/** POST: validate and submit, freezing the response. */
export async function handleSubmit(req: Request, ref: Ref) {
  const r = await resolveSession(req, ref, { write: true })
  if ('error' in r) return r.error
  const { db, session, from } = r
  if (!session.response && session.state === 'open') session.response = await openSession(db, session, from)
  const b = await body(req)
  const res = await submitResponse(db, session, { answers: b.answers }, from)
  if (!res.ok) return NextResponse.json({ error: res.error, fieldErrors: res.fieldErrors }, { status: res.status })
  return NextResponse.json({ submittedAt: res.submittedAt })
}
