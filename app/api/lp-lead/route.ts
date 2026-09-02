import { NextResponse } from 'next/server'
import { z } from 'zod'
import { HS, LEAD_SOURCE_LIFECYCLE } from '@/lib/hubspot-fields'
import { captureLead, logLine, readHubspotCookie } from '@/lib/hubspot'
import { HOUR_MS, rateLimitGuard } from '@/lib/rate-limit'
import { getLandingPage } from '@/content/lp'

/**
 * Audience landing page lead capture.
 *
 * Goes through captureLead() rather than posting to the HubSpot Forms API
 * directly, which the design handoff proposed. That orchestrator is what gives
 * a lead the form submission (the conversion, the source attribution), the note
 * engagement, an append-only activity log, a lifecycle stage that will not
 * demote an existing customer, and a dead-letter alert when every write fails.
 * A second, parallel HubSpot code path would have none of that and would have
 * to be kept in step with the first by hand.
 *
 * One shared HubSpot form serves every audience page; `lp_audience` and
 * `lp_source_page` are what separate them in reporting. Six more pages are
 * expected in the next twelve months and none of them will need a new form,
 * a new workflow or a new env var.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

const schema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(254),
  role: z.enum(['teacher', 'parent', 'student']),
  // The client sends nothing rather than 0 for a blank field; both are rejected
  // below rather than written, because HubSpot stores what it is given.
  students: z.number().int().min(1).max(500).optional(),
  consent: z.literal(true),
  pageSlug: z.string().min(1).max(120),
  audience: z.string().min(1).max(60),
  utm_source: z.string().max(200).optional(),
  utm_medium: z.string().max(200).optional(),
  utm_campaign: z.string().max(200).optional(),
  utm_content: z.string().max(200).optional(),
  utm_term: z.string().max(200).optional(),
})

/**
 * Split a single name field for HubSpot's firstname/lastname.
 *
 * One field is asked for because two is a measurable drop in completion on a
 * lead form, and HubSpot needs the pair. Everything after the first space is
 * the surname, which handles "Alex van der Berg" correctly and mis-handles
 * nothing worse than a middle name landing in `lastname`.
 */
function splitName(full: string): { firstName: string; lastName?: string } {
  const trimmed = full.trim().replace(/\s+/g, ' ')
  const space = trimmed.indexOf(' ')
  if (space === -1) return { firstName: trimmed }
  return { firstName: trimmed.slice(0, space), lastName: trimmed.slice(space + 1) }
}

export async function POST(req: Request) {
  // 5/hour: generous for a person who mistypes their email twice, tight enough
  // that the shared HubSpot form is not a spam target.
  const limited = rateLimitGuard(req, 'lp-lead', { limit: 5, windowMs: HOUR_MS })
  if (limited) return limited

  try {
    const parsed = schema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid submission' }, { status: 400 })
    }
    const data = parsed.data

    // The slug must be a page we actually publish. Without this check the
    // `lp_source_page` dropdown fills up with whatever anyone cares to POST,
    // and the per-page reporting these pages exist to produce becomes noise.
    const config = getLandingPage(data.pageSlug)
    if (!config) {
      return NextResponse.json({ error: 'Unknown page' }, { status: 400 })
    }

    const { firstName, lastName } = splitName(data.name)

    // Built by omission, never by empty string: HubSpot writes '' straight over
    // an existing value, so a blank UTM here would erase a real one captured on
    // an earlier visit.
    const properties: Record<string, string> = {
      [HS.stellrRole]: data.role,
      [HS.lpAudience]: config.audience,
      [HS.lpSourcePage]: config.slug,
      [HS.lpProgramInterest]: 'space-design-competition',
      ...(data.students ? { [HS.expectedStudentCount]: String(data.students) } : {}),
      ...(data.utm_source ? { [HS.lpUtmSource]: data.utm_source } : {}),
      ...(data.utm_medium ? { [HS.lpUtmMedium]: data.utm_medium } : {}),
      ...(data.utm_campaign ? { [HS.lpUtmCampaign]: data.utm_campaign } : {}),
      ...(data.utm_content ? { [HS.lpUtmContent]: data.utm_content } : {}),
      ...(data.utm_term ? { [HS.lpUtmTerm]: data.utm_term } : {}),
    }

    const detail = [
      config.audience,
      data.role,
      data.students ? `${data.students} student${data.students === 1 ? '' : 's'}` : null,
    ]
      .filter(Boolean)
      .join(' · ')

    const result = await captureLead({
      email: data.email,
      firstName,
      lastName,
      source: 'landing_page',
      properties,
      lifecycleStage: LEAD_SOURCE_LIFECYCLE.landing_page,
      activity: `Landing page enquiry — /lp/${config.slug} (${detail}).`,
      logEntry: logLine('landing_page', detail),
      context: {
        hutk: readHubspotCookie(req),
        pageUri: `${SITE_URL}/lp/${config.slug}`,
        pageName: config.seo.title,
      },
    })

    // A failed capture is reported honestly so the client can show the "we
    // could not confirm your details were saved" line — but it is still a 200,
    // because the visitor must reach the booking calendar either way. A booked
    // call we have to reconcile by hand beats a visitor sent to a dead end,
    // and captureLead has already dead-lettered and alerted on the failure.
    return NextResponse.json({ ok: result.ok, stored: result.via !== 'none' })
  } catch (err) {
    console.error('[lp-lead] Unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
