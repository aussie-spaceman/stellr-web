import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sendEmail } from '@/lib/email'
import { captureLead, logLine, readHubspotCookie } from '@/lib/hubspot'
import {
  HS,
  LEAD_SOURCE_LIFECYCLE,
  STIPEND_ACTIVITIES,
  STIPEND_PRIOR,
  STIPEND_STATUS,
  hubspotDateValue,
} from '@/lib/hubspot-fields'
import { rateLimitGuard, HOUR_MS } from '@/lib/rate-limit'
import { supabaseServer } from '@/lib/supabase'
import { upsertMember } from '@/lib/member-sync'
import { linkMembersToSchoolByName } from '@/lib/school-link'
import { autoGrantBaseMembership } from '@/lib/auto-membership-grant'
import { GENDERS } from '@/lib/registration-constants'
import { STIPEND_DEMOGRAPHIC, STIPEND_PROGRAM_YEAR } from '@/lib/stipend'

const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? 'hello@stellreducation.org'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

/**
 * Server-side schema. The client validates the same shape for the sake of the
 * person filling it in, but a bot POSTs JSON straight at this route and never
 * runs that code — so this is the validation that counts. Every string is
 * length-capped: HubSpot rejects an over-long property value and would take the
 * whole capture down with it.
 */
const schema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(50).optional().default(''),
  schoolName: z.string().trim().min(1).max(200),
  schoolCity: z.string().trim().min(1).max(100),
  schoolState: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((v) => v.toUpperCase()),
  subjects: z.string().trim().min(1).max(200),
  yearsTeaching: z.string().trim().max(30).optional().default(''),
  // members.date_of_birth and members.gender are NOT NULL with no default, so
  // these are what make the Educator registration below possible at all.
  dateOfBirth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum(GENDERS as [string, ...string[]]),
  plannedActivities: z.enum(['challenge', 'campaign', 'both']),
  expectedStudents: z.string().trim().regex(/^\d{1,4}$/),
  priorStellr: z.enum(['yes', 'no']).optional(),
  motivation: z.string().trim().min(40).max(5000),
  referralSource: z.string().trim().max(200).optional().default(''),
  consent: z.literal(true),
  acknowledgePayment: z.literal(true),
  /**
   * Honeypot. Named `website` per docs/REC-form-spam-hardening.md — *not*
   * `company`, which browsers and password managers autofill as an
   * organization field. A real teacher's autofill would look exactly like a bot
   * and their application would vanish into the silent accept below.
   */
  website: z.string().max(200).optional().default(''),
})

/** Escape user input before interpolating it into the notification email. */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function POST(req: Request) {
  const limited = rateLimitGuard(req, 'teacher-stipend', { limit: 3, windowMs: HOUR_MS })
  if (limited) return limited

  try {
    const parsed = schema.safeParse(await req.json())

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Some answers need attention.',
          fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0])))],
        },
        { status: 400 },
      )
    }

    const v = parsed.data

    // Honeypot tripped: accept silently. A 400 here teaches the bot to retry
    // with the field cleared.
    if (v.website) {
      console.warn('[spam] honeypot teacher-stipend')
      return NextResponse.json({ ok: true })
    }

    const name = `${v.firstName} ${v.lastName}`
    const activities = STIPEND_ACTIVITIES[v.plannedActivities]
    const rows: [string, string][] = [
      ['Name', name],
      ['Email', `<a href="mailto:${esc(v.email)}">${esc(v.email)}</a>`],
      ['Phone', esc(v.phone) || '—'],
      ['School', esc(v.schoolName)],
      ['Location', `${esc(v.schoolCity)}, ${esc(v.schoolState)}`],
      ['Subjects', esc(v.subjects)],
      ['Years teaching', esc(v.yearsTeaching) || '—'],
      ['Plans to run', esc(activities)],
      ['Expected students', esc(v.expectedStudents)],
      ['Run Stellr before', v.priorStellr ? esc(STIPEND_PRIOR[v.priorStellr]) : '—'],
      ['Heard about it via', esc(v.referralSource) || '—'],
      ['Program year', esc(STIPEND_PROGRAM_YEAR)],
    ]
    const htmlRows = rows
      .map(
        ([label, value]) =>
          `<tr><td style="padding:8px;font-weight:bold;background:#f3f4f6;vertical-align:top">${label}</td><td style="padding:8px">${value}</td></tr>`,
      )
      .join('')

    const subject = `Teacher Stipend application — ${name}, ${v.schoolName}`
    const html = `
      <h2>New Teacher Stipend application</h2>
      <table style="border-collapse:collapse;width:100%;max-width:600px">${htmlRows}</table>
      <h3 style="margin:20px 0 6px">Why they want to take part</h3>
      <p style="white-space:pre-wrap;margin:0">${esc(v.motivation)}</p>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px">
        Consent given: yes · Payment terms acknowledged: yes<br>
        Sent via the Stellr Education website Teacher Stipend form.
      </p>
    `
    const text = [
      'New Teacher Stipend application',
      '',
      `Name: ${name}`,
      `Email: ${v.email}`,
      `Phone: ${v.phone || '—'}`,
      `School: ${v.schoolName}`,
      `Location: ${v.schoolCity}, ${v.schoolState}`,
      `Subjects: ${v.subjects}`,
      `Years teaching: ${v.yearsTeaching || '—'}`,
      `Plans to run: ${activities}`,
      `Expected students: ${v.expectedStudents}`,
      `Run Stellr before: ${v.priorStellr ? STIPEND_PRIOR[v.priorStellr] : '—'}`,
      `Heard about it via: ${v.referralSource || '—'}`,
      `Program year: ${STIPEND_PROGRAM_YEAR}`,
      '',
      'Why they want to take part:',
      v.motivation,
    ].join('\n')

    // The email is the durable record of an application, so it is sent first
    // and its failure is the one that fails the request.
    await sendEmail({ to: CONTACT_EMAIL, replyTo: v.email, subject, html, text })

    // Capture in HubSpot with full visibility — form submission, note
    // engagement and properties. Best-effort by construction: captureLead
    // dead-letters and alerts rather than throwing, so a CRM outage never
    // costs us an application that already reached the inbox.
    await captureLead({
      email: v.email,
      firstName: v.firstName,
      lastName: v.lastName,
      source: 'teacher_stipend',
      lifecycleStage: LEAD_SOURCE_LIFECYCLE.teacher_stipend,
      activity:
        `Teacher Stipend application (${STIPEND_PROGRAM_YEAR}) — ${v.schoolName}, ` +
        `${v.schoolCity}, ${v.schoolState}. Plans to run: ${activities}, ` +
        `~${v.expectedStudents} students.`,
      logEntry: logLine('teacher_stipend', `${activities} · ${v.schoolName} · ${STIPEND_PROGRAM_YEAR}`),
      properties: {
        ...(v.phone ? { [HS.phone]: v.phone } : {}),
        [HS.school]: v.schoolName,
        [HS.city]: v.schoolCity,
        [HS.state]: v.schoolState,
        // The cohort year is a program constant, not something the browser
        // gets a say in — a forged payload must not book a place in 2028.
        [HS.stipendProgramYear]: STIPEND_PROGRAM_YEAR,
        [HS.stipendStatus]: STIPEND_STATUS.applied,
        [HS.stipendApplicationDate]: hubspotDateValue(new Date()),
        [HS.stipendPlannedActivities]: activities,
        [HS.stipendExpectedStudents]: v.expectedStudents,
        [HS.stipendSubjects]: v.subjects,
        // The stipend is high-school-only, so the demographic is known without
        // asking — see STIPEND_DEMOGRAPHIC.
        [HS.eventDemographic]: STIPEND_DEMOGRAPHIC,
        [HS.jobTitle]: 'Teacher',
        ...(v.yearsTeaching ? { [HS.stipendYearsTeaching]: v.yearsTeaching } : {}),
        ...(v.priorStellr ? { [HS.stipendPriorStellr]: STIPEND_PRIOR[v.priorStellr] } : {}),
        [HS.stipendMotivation]: v.motivation,
        ...(v.referralSource ? { [HS.stipendReferralSource]: v.referralSource } : {}),
      },
      context: {
        hutk: readHubspotCookie(req),
        pageUri: `${SITE_URL}/educators#stipend`,
        pageName: 'Teacher Stipend application',
      },
    })

    // ── Register the applicant as an Educator ────────────────────────────
    // The stipend is for teachers, and a teacher who applies is a teacher we
    // want on the books — so the form doubles as the free Educator signup
    // rather than asking them to go and do it separately.
    //
    // `upsertMember` cross-references on the normalised email: an existing
    // Stellr account is UPDATED, never duplicated, and every field left blank
    // keeps whatever is already on file. `autoGrantBaseMembership` maps the
    // 'adult' bracket to Educator and is guarded to non-members, so a teacher
    // who already holds Catalyst is not downgraded.
    //
    // All three steps are non-fatal by construction — the application has
    // already reached the inbox and HubSpot by this point, and losing the
    // membership grant is recoverable in a way that losing the application is
    // not.
    try {
      const db = supabaseServer()
      const memberId = await upsertMember(db, {
        email: v.email,
        first_name: v.firstName,
        last_name: v.lastName,
        phone: v.phone || null,
        date_of_birth: v.dateOfBirth,
        gender: v.gender,
        age_bracket: 'adult',
        event_role: 'teacher',
      })

      if (memberId) {
        await linkMembersToSchoolByName(db, [memberId], {
          name: v.schoolName,
          address_city: v.schoolCity,
          address_state: v.schoolState,
        })
        await autoGrantBaseMembership(db, memberId)
      } else {
        console.error('[teacher-stipend] Member upsert returned no id for', v.email)
      }
    } catch (err) {
      console.error('[teacher-stipend] Educator registration failed (non-fatal):', err)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[teacher-stipend] Unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
