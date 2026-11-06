// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { TABLE_REGISTRY } from '@/lib/tenancy/registry'
import { STELLR_OR_NULL, otherTenantEvents } from '@/lib/tenancy/stellr-scope'

// S5 B11. Each Stellr-only cron reads Stellr's rows and rows with no tenant yet,
// and never another tenant's. These run the real query code on the real
// supabase-js builder, against a small stand-in for PostgREST that evaluates what
// the builder put in the URL, so a filter that is missing or wrong changes the
// rows that come back. Like PostgREST it answers an error for a tenant_id filter
// on a table with no such column.

const CANARY = '00000000-0000-4000-8000-00000000c0de'

const h = vi.hoisted(() => ({
  db: null as unknown,
  sendEmail: vi.fn(async () => {}),
  notifyMember: vi.fn(async () => {}),
  recordOptOut: vi.fn(async () => 'recorded'),
  datedSlugs: [] as string[],
  syncEventOptions: vi.fn(async (_opts: Record<string, unknown>) => ({
    ok: true, applied: false, refused: undefined, liveEvents: [], properties: [], form: { status: 'skipped' }, unmapped: [],
  })),
}))

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db }))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail, staffAlertEmail: () => 'staff@example.org' }))
vi.mock('@/lib/notify', () => ({ notifyMember: h.notifyMember, notifyCommunityAdmins: vi.fn() }))
vi.mock('@/lib/activity-log', () => ({ logActivity: vi.fn(async () => {}) }))
vi.mock('@/lib/compliance-admin', () => ({
  getComplianceAudit: async () => ({ rows: [], reviewQueue: [], counts: { in_process: 0, invalid: 0, expired: 0, cancelled: 0 } }),
}))
vi.mock('@/lib/sanity', () => {
  const event = (slug: string) => ({ _id: `sanity-${slug}`, slug: { current: slug }, title: `Title ${slug}`, date: '2026-11-20' })
  return {
    getEventsBySlugs: async (slugs: string[]) => {
      h.datedSlugs.push(...slugs)
      return slugs.map(event)
    },
    getEventBySlug: async (slug: string) => event(slug),
    getEventsByIds: async (ids: string[]) => ids.map((id) => event(id.replace('sanity-', ''))),
  }
})
vi.mock('@/lib/docusign-optout', () => ({ OPT_OUT_ENVELOPE_COLUMNS: 'id', recordCredentialOptOutFromForm: h.recordOptOut }))
vi.mock('@/lib/esign/maintenance', () => ({ runEsignMaintenance: async () => ({}) }))
vi.mock('@/lib/hubspot-event-options', () => ({ syncEventOptions: h.syncEventOptions }))
vi.mock('@/lib/cron-runs', () => ({
  startCronRun: async () => ({ fail: vi.fn(), finish: vi.fn(async () => {}) }),
}))

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>
type Logged = { table: string; method: string; url: URL; body?: unknown }

function matches(row: Row, column: string, expr: string): boolean {
  const value = row[column]
  if (expr.startsWith('not.')) return !matches(row, column, expr.slice(4))
  const dot = expr.indexOf('.')
  const op = expr.slice(0, dot)
  const arg = expr.slice(dot + 1)
  switch (op) {
    case 'is':
      if (arg !== 'null') throw new Error(`stand-in: is.${arg}`)
      return value === null || value === undefined
    case 'eq':
      return String(value) === arg
    case 'neq':
      return value !== null && value !== undefined && String(value) !== arg
    case 'in':
      return arg.slice(1, -1).split(',').map((v) => v.replace(/^"|"$/g, '')).includes(String(value))
    case 'gte':
      return value !== null && value !== undefined && String(value) >= arg
    case 'lte':
      return value !== null && value !== undefined && String(value) <= arg
    case 'lt':
      return value !== null && value !== undefined && String(value) < arg
    default:
      throw new Error(`stand-in does not evaluate ${expr}`)
  }
}

/** Splits an or=(...) on the commas outside parentheses. */
function orTerms(value: string): string[] {
  const inner = value.slice(1, -1)
  const terms: string[] = []
  let depth = 0
  let current = ''
  for (const ch of inner) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      terms.push(current)
      current = ''
    } else current += ch
  }
  terms.push(current)
  return terms
}

function hasTenantColumn(table: string): boolean {
  const entry = TABLE_REGISTRY[`public.${table}`]
  return entry?.tenantColumn === 'derived' || entry?.tenantColumn === 'own'
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'columns'])

function parseOr(value: string) {
  return orTerms(value).map((t) => {
    const dot = t.indexOf('.')
    return [t.slice(0, dot), t.slice(dot + 1)] as const
  })
}

function standIn(tables: Tables, opts: { failing?: string[]; maxRows?: number } = {}) {
  const log: Logged[] = []
  const handler = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const table = url.pathname.split('/').pop() as string
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    log.push({ table, method, url, body })
    if (method === 'POST') return new Response(null, { status: 201 })
    if (method === 'PATCH') return new Response(null, { status: 204 })
    if (opts.failing?.includes(table)) {
      return new Response(JSON.stringify({ code: 'XX000', message: `${table} is unavailable` }), { status: 500 })
    }

    let rows = tables[table] ?? []
    for (const [key, value] of url.searchParams) {
      if (RESERVED.has(key)) continue
      if (key.includes('.')) {
        // A filter on an embedded table: mentoring_cohorts.campaign_ref=eq.x or
        // mentoring_cohorts.or=(...). A row with no such embed in the fixture keeps.
        const [embed, column] = key.split('.')
        rows = rows.filter((r) => {
          const embedded = r[embed] as Row | undefined
          if (!embedded) return true
          return column === 'or'
            ? parseOr(value).some(([c, e]) => matches(embedded, c, e))
            : matches(embedded, column, value)
        })
      } else if (key === 'or') {
        const terms = parseOr(value)
        if (terms.some(([c]) => c === 'tenant_id') && !hasTenantColumn(table)) {
          return new Response(JSON.stringify({ code: '42703', message: `column ${table}.tenant_id does not exist` }), { status: 400 })
        }
        rows = rows.filter((r) => terms.some(([c, e]) => matches(r, c, e)))
      } else {
        if (key === 'tenant_id' && !hasTenantColumn(table)) {
          return new Response(JSON.stringify({ code: '42703', message: `column ${table}.tenant_id does not exist` }), { status: 400 })
        }
        rows = rows.filter((r) => matches(r, key, value))
      }
    }
    if (method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-range': `0-0/${rows.length}` } })
    }
    // Like PostgREST, shortens to the row cap without saying so.
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const limit = Math.min(Number(url.searchParams.get('limit') ?? Infinity), opts.maxRows ?? Infinity)
    rows = rows.slice(offset, offset + limit)
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const db = createClient('http://stand-in.test', 'key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: handler as typeof fetch },
  })
  return { db: db as SupabaseClient, log }
}

const standInWith = (opts: { failing?: string[]; maxRows?: number }) => (tables: Tables) => standIn(tables, opts)

const NOW = new Date('2026-11-06T18:00:00Z')
const STELLR = { tenant_id: STELLR_TENANT_ID }
const NO_TENANT = { tenant_id: null }
const OTHER = { tenant_id: CANARY }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  h.sendEmail.mockClear()
  h.notifyMember.mockClear()
  h.recordOptOut.mockClear()
  h.datedSlugs.length = 0
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('the filter itself', () => {
  it('keeps Stellr and NULL, and drops another tenant', async () => {
    const { stellrRows } = await import('@/lib/tenancy/stellr-scope')
    const { db } = standIn({ registrations: [{ id: 's', ...STELLR }, { id: 'n', ...NO_TENANT }, { id: 'o', ...OTHER }] })
    const { data } = await stellrRows(db.from('registrations').select('id'))
    expect((data ?? []).map((r) => r.id)).toEqual(['s', 'n'])
    expect(STELLR_OR_NULL).toContain('tenant_id.is.null')
  })

  it('leaves a query unchanged when every row is Stellr or NULL', async () => {
    const { stellrRows } = await import('@/lib/tenancy/stellr-scope')
    const rows = [{ id: 's', ...STELLR }, { id: 'n', ...NO_TENANT }]
    const { db } = standIn({ registrations: rows })
    const [filtered, plain] = await Promise.all([
      stellrRows(db.from('registrations').select('id')),
      db.from('registrations').select('id'),
    ])
    expect(filtered.data).toEqual(plain.data)
  })

  it('errors on a table with no tenant column, which is why participants go through their parent', async () => {
    const { stellrRows } = await import('@/lib/tenancy/stellr-scope')
    const { db } = standIn({ participants: [{ id: 'p' }] })
    const { error } = await stellrRows(db.from('participants').select('id'))
    expect(error?.code).toBe('42703')
  })

  it('names the events other tenants own, and throws rather than answer none on a failed read', async () => {
    const events = [{ slug: 'ours', sanity_id: 's-ours', ...STELLR }, { slug: 'theirs', sanity_id: 's-theirs', ...OTHER }]
    const found = await otherTenantEvents(standIn({ events }).db)
    expect([...found.slugs]).toEqual(['theirs'])
    expect([...found.sanityIds]).toEqual(['s-theirs'])
    await expect(otherTenantEvents(standIn({ events }, { failing: ['events'] }).db)).rejects.toThrow('events is unavailable')
  })

  it('lists every event when the database caps each read', async () => {
    const events = Array.from({ length: 1500 }, (_, i) => ({ slug: `e${i}`, sanity_id: `s${i}`, ...OTHER }))
    const found = await otherTenantEvents(standIn({ events }, { maxRows: 400 }).db)
    expect(found.slugs.size).toBe(1500)
    expect(found.sanityIds.has('s1499')).toBe(true)
  })
})

/** One registration, agreement, invoice, application and sign-up per tenant state. */
function digestTables(states: Array<[string, Row]>): Tables {
  const at = '2026-11-04T12:00:00.000Z'
  const tables: Tables = {
    registrations: [], volunteer_event_interest: [], agreements: [], group_invoices: [], scholarship_applications: [],
    cohort_members: [], community_spaces: [], community_posts: [], community_comments: [], chat_messages: [], community_space_members: [],
    events: [],
  }
  // A mentoring group that serves no event, with no tenant yet, stays Stellr's.
  tables.cohort_members.push(
    { member_id: 'cohort-plain', relationship: 'participant', added_at: at, mentoring_cohorts: { name: 'Plain group', campaign_ref: null, tenant_id: null } },
    { member_id: 'cohort-no-group', relationship: 'participant', added_at: at, mentoring_cohorts: null },
  )
  for (const [name, tenant] of states) {
    const person = (suffix: string) => ({
      id: `p-${name}-${suffix}`, first_name: `${name}${suffix}`, last_name: 'Person', email: `${name}@example.org`,
      date_of_birth: '2010-01-01', event_role: 'student', individual_payment_status: null,
    })
    tables.registrations.push(
      {
        id: `reg-${name}`, event_slug: `event-${name}`, event_title: `Event ${name}`, type: 'individual', status: 'confirmed',
        created_at: at, withdrawn_at: null, amount_due_cents: 5000, invoice_requested: true, invoice_paid_at: null,
        member_pays_individually: false, participants: [person('Live')], ...tenant,
      },
      {
        id: `gone-${name}`, event_slug: `event-${name}`, event_title: `Event ${name}`, type: 'individual', status: 'withdrawn',
        created_at: '2026-01-01T00:00:00.000Z', withdrawn_at: at, participants: [person('Gone')], ...tenant,
      },
    )
    tables.volunteer_event_interest.push({ member_id: `vol-${name}`, event_title: `Volunteer ${name}`, event_slug: `event-${name}`, status: 'new', created_at: at, ...tenant })
    tables.agreements.push({
      id: `agr-${name}`, envelope_id: 'env', envelope_type: 'minor', status: 'sent', signer_name: `Signer${name}`, minor_name: `Minor${name}`,
      event_title: `Event ${name}`, event_slug: `event-${name}`, sent_at: at, created_at: at, reminder_count: 0, member_id: null,
      participant_id: `p-none-${name}`, ...tenant,
    })
    tables.group_invoices.push({ id: `inv-${name}`, registration_id: `reg-${name}`, total_cents: 100, stripe_invoice_number: `INV-${name}`, created_at: at, status: 'open', ...tenant })
    tables.scholarship_applications.push({ id: `sch-${name}`, first_name: `Applicant${name}`, last_name: 'A', event_title: `Event ${name}`, created_at: at, status: 'submitted', ...tenant })
    tables.cohort_members.push({
      member_id: `cohort-${name}`, relationship: 'participant', added_at: at,
      mentoring_cohorts: { name: `Cohort ${name}`, campaign_ref: `event-${name}`, tenant_id: tenant.tenant_id },
    })
    const spaceId = `space-${name}`
    tables.community_spaces.push({ id: spaceId, name: `Space ${name}`, ...tenant })
    tables.community_posts.push({ space_id: spaceId, author_member_id: `poster-${name}`, created_at: at, status: 'published' })
    tables.community_comments.push({ author_member_id: `commenter-${name}`, created_at: at, status: 'published', community_posts: { space_id: spaceId } })
    tables.chat_messages.push({ author_member_id: `chatter-${name}`, created_at: at, deleted_at: null, chat_channels: { space_id: spaceId } })
    tables.community_space_members.push({ space_id: spaceId, member_id: `joiner-${name}`, added_at: at })
  }
  // Another tenant's rows that point at Stellr's own event and registration, so
  // that dropping them cannot be left to a later read's slug or id list.
  if (states.some(([name]) => name === 'Canary')) {
    tables.registrations.push({
      id: 'reg-crossed', event_slug: 'event-Stellr', event_title: 'Event Canary', type: 'individual', status: 'confirmed',
      created_at: at, withdrawn_at: null, amount_due_cents: 5000, invoice_requested: true, invoice_paid_at: null, member_pays_individually: false,
      participants: [{ id: 'p-crossed', first_name: 'CanaryCrossed', last_name: 'Person', email: 'c@example.org', date_of_birth: '2010-01-01', event_role: 'student', individual_payment_status: null }],
      ...OTHER,
    })
    tables.group_invoices.push({ id: 'inv-crossed', registration_id: 'reg-Stellr', total_cents: 999, stripe_invoice_number: 'INV-Canary-crossed', created_at: at, status: 'open', ...OTHER })
    tables.events.push({ id: 'e-canary', slug: 'event-Canary', sanity_id: 'sanity-event-Canary', ...OTHER })
    // A group on another tenant's event carries Stellr's stamp, as the derivation
    // trigger gives one created with no sanity_event_id.
    tables.cohort_members.push({
      member_id: 'cohort-stamped', relationship: 'participant', added_at: at,
      mentoring_cohorts: { name: 'Canary group, stamped Stellr', campaign_ref: 'event-Canary', tenant_id: STELLR_TENANT_ID },
    }, {
      // And one stamped for that tenant, serving no event.
      member_id: 'cohort-owned', relationship: 'participant', added_at: at,
      mentoring_cohorts: { name: 'Canary group, no event', campaign_ref: null, tenant_id: CANARY },
    })
  }
  return tables
}

describe('weekly-digest', () => {
  const load = async (tables: Tables) => {
    const { loadMemberDigest } = await import('@/lib/admin-digest')
    const { renderDigestEmail } = await import('@/lib/admin-digest-email')
    const digest = await loadMemberDigest(7, { now: NOW, db: standIn(tables).db })
    return { digest, email: renderDigestEmail(digest, { appUrl: 'https://app.example.org', now: NOW }) }
  }

  it('reads Stellr and NULL rows and no other tenant, with every section loading', async () => {
    const { digest } = await load(digestTables([['Stellr', STELLR], ['Unstamped', NO_TENANT], ['Canary', OTHER]]))
    expect(digest.errors).toEqual([])

    const text = JSON.stringify({ ...digest })
    expect(text).not.toContain('Canary')
    expect(h.datedSlugs.join()).not.toContain('Canary')

    // Both rows reach every section, so none of them hides a NULL row.
    for (const name of ['Stellr', 'Unstamped']) {
      expect(digest.growth.registrations.items.map((i) => i.detail).join()).toContain(`Event ${name}`)
      expect(digest.left.withdrew.items.map((i) => i.detail).join()).toContain(`Event ${name}`)
      expect(digest.mentoring.volunteerSignups.people.map((i) => i.detail).join()).toContain(`Volunteer ${name}`)
      expect(digest.outstanding.awaitingSignature.map((i) => i.signerName)).toContain(`Signer${name}`)
      expect(digest.outstanding.paperworkGaps.map((i) => i.eventSlug)).toContain(`event-${name}`)
      expect(digest.outstanding.payments.map((i) => i.eventSlug)).toContain(`event-${name}`)
      expect(digest.outstanding.queues.scholarships.map((i) => i.label).join()).toContain(`Applicant${name}`)
      expect(digest.mentoring.cohortJoins.people.map((i) => i.detail)).toContain(`Cohort ${name}`)
      expect(digest.engagement.topSpaces.map((s) => s.name)).toContain(`Space ${name}`)
    }
    // Groups with no event and no tenant stay, and so does a roster row with no group.
    expect(digest.mentoring.cohortJoins.people.map((i) => i.detail)).toEqual(expect.arrayContaining(['Plain group', 'Mentoring group']))
    expect(digest.mentoring.cohortJoins.current).toBe(4)
    // Only the two Stellr Spaces' activity counts.
    expect(digest.engagement.posts.current).toBe(2)
    expect(digest.engagement.comments.current).toBe(2)
    expect(digest.engagement.chatMessages.current).toBe(2)
    expect(digest.engagement.spaceJoins.current).toBe(2)
    expect(digest.engagement.activeMembers.current).toBe(6)
  })

  it('reports the sections it cannot limit, rather than show them unlimited', async () => {
    const tables = digestTables([['Stellr', STELLR], ['Canary', OTHER]])
    const { loadMemberDigest } = await import('@/lib/admin-digest')
    const failedMirror = await loadMemberDigest(7, { now: NOW, db: standIn(tables, { failing: ['events'] }).db })
    expect(failedMirror.errors).toContain('Mentoring and coaching')
    expect(failedMirror.mentoring.cohortJoins.people).toEqual([])
    const failedSpaces = await loadMemberDigest(7, { now: NOW, db: standIn(tables, { failing: ['community_spaces'] }).db })
    expect(failedSpaces.errors).toContain('Community activity')
    expect(failedSpaces.engagement.topSpaces).toEqual([])
  })

  it('sends the same body with another tenant on file as with Stellr alone', async () => {
    const stellrAlone = await load(digestTables([['Stellr', STELLR], ['Unstamped', NO_TENANT]]))
    const withOther = await load(digestTables([['Stellr', STELLR], ['Unstamped', NO_TENANT], ['Canary', OTHER]]))
    expect(withOther.email.subject).toBe(stellrAlone.email.subject)
    expect(withOther.email.html).toBe(stellrAlone.email.html)
    expect(withOther.email.text).toBe(stellrAlone.email.text)
  })

  it('leaves the paperwork list as wide as it was for a caller that does not ask', async () => {
    const { loadPaperworkGaps } = await import('@/lib/esign/needs-paperwork')
    const tables = digestTables([['Stellr', STELLR], ['Canary', OTHER]])
    const wide = await loadPaperworkGaps(standIn(tables).db, NOW)
    const narrow = await loadPaperworkGaps(standIn(tables).db, NOW, { stellrOnly: true })
    // Canary's own row, and its row on Stellr's event, are both still listed.
    expect(wide.map((g) => g.eventSlug).sort()).toEqual(['event-Canary', 'event-Stellr', 'event-Stellr'])
    expect(narrow.map((g) => g.eventSlug)).toEqual(['event-Stellr'])
  })
})

describe('background-sync reminders', () => {
  it('reminds adults on Stellr and NULL registrations and not on another tenant', async () => {
    const { remindUnclearedAdults } = await import('@/lib/compliance-notify')
    const created = '2026-10-01T00:00:00.000Z'
    const reg = (id: string, tenant: Row) => ({ id, event_slug: `event-${id}`, event_title: id, status: 'confirmed', created_at: created, ...tenant })
    const person = (reg_id: string, member_id: string) => ({ registration_id: reg_id, member_id, event_role: 'teacher', date_of_birth: '1980-01-01' })
    const member = (id: string) => ({ id, email: `${id}@example.org`, date_of_birth: '1980-01-01', member_teacher_licenses: [], member_background_checks: [] })
    const { db, log } = standIn({
      registrations: [reg('stellr', STELLR), reg('unstamped', NO_TENANT), reg('canary', OTHER)],
      participants: [person('stellr', 'm-stellr'), person('unstamped', 'm-unstamped'), person('canary', 'm-canary')],
      members: [member('m-stellr'), member('m-unstamped'), member('m-canary')],
      member_activity_log: [],
    })

    const result = await remindUnclearedAdults(db, { now: NOW, dryRun: true })

    expect(result.errors).toEqual([])
    expect(result.events).toBe(2)
    expect(result.eventsInWindow).toBe(2)
    expect(result.uncleared).toBe(2)
    expect(result.due).toBe(2)
    const participantReads = log.filter((l) => l.table === 'participants').map((l) => l.url.searchParams.get('registration_id'))
    expect(participantReads.join()).not.toContain('canary')
  })
})

describe('training-reminders', () => {
  const due = '2026-11-07T12:00:00.000Z'
  const objectAssignment = (id: string, objectType: string, ref: string, dueAt = due) => ({
    id, module_id: 'module', object_type: objectType, object_ref: ref, default_requirement: 'mandatory',
    tier_requirements: null, due_at: dueAt, audience: 'all',
  })
  const volunteer = (memberId: string, slug: string, tenantId: string | null) => ({
    member_id: memberId, cohort_id: `container-${slug}`, relationship: 'volunteer', status: 'active',
    mentoring_cohorts: { campaign_ref: slug, container_type: 'event_participation', tenant_id: tenantId },
    members: { first_name: 'V', last_name: memberId },
  })
  const rosterRow = (memberId: string, cohortId: string) => ({
    member_id: memberId, cohort_id: cohortId, relationship: 'participant', status: 'active',
    members: { first_name: 'C', last_name: memberId },
  })

  const trainingTables = (overrides: Tables = {}, opts: { failing?: string[] } = {}) => {
    const assignment = (id: string, slug: string, tenant: Row) => ({
      id, module_id: 'module', event_ref: `sanity-${slug}`, event_role: 'all', is_mandatory: true, due_at: due, ...tenant,
    })
    const registration = (slug: string, tenant: Row) => ({ id: `reg-${slug}`, event_slug: slug, teacher_email: null, teacher_first_name: null, ...tenant })
    const person = (slug: string) => ({ registration_id: `reg-${slug}`, member_id: `m-${slug}`, first_name: 'A', last_name: 'B', event_role: 'student' })
    const { db, log } = standInWith(opts)({
      training_assignments: [
        assignment('a-stellr', 'stellr', STELLR),
        assignment('a-unstamped', 'unstamped', NO_TENANT),
        assignment('a-canary', 'canary', OTHER),
        // Another tenant's assignment on Stellr's event.
        assignment('a-crossed', 'stellr', OTHER),
      ],
      course_object_assignments: [
        // A Stellr course pointed at an event slug: only that event's Stellr rows.
        objectAssignment('obj', 'competition', 'shared'),
        // The same course on another tenant's event.
        objectAssignment('obj-theirs', 'competition', 'theirs'),
        objectAssignment('obj-cohort', 'cohort', 'cohort-stellr'),
        objectAssignment('obj-cohort-canary', 'cohort', 'cohort-canary'),
        objectAssignment('obj-cohort-on-theirs', 'cohort', 'cohort-on-theirs'),
      ],
      events: [
        { id: 'e-theirs', slug: 'theirs', sanity_id: 'sanity-theirs', ...OTHER },
        { id: 'e-shared', slug: 'shared', sanity_id: 'sanity-shared', ...STELLR },
      ],
      mentoring_cohorts: [
        { id: 'cohort-stellr', mentor_member_id: 'mentor', campaign_ref: null, ...NO_TENANT },
        { id: 'cohort-canary', mentor_member_id: 'mentor-canary', campaign_ref: null, ...OTHER },
        // Stamped Stellr by the trigger, though it serves another tenant's event.
        { id: 'cohort-on-theirs', mentor_member_id: 'mentor-canary', campaign_ref: 'theirs', ...STELLR },
      ],
      cohort_members: [
        volunteer('vol-shared', 'shared', STELLR_TENANT_ID),
        volunteer('vol-shared-unstamped', 'shared', null),
        volunteer('vol-shared-canary', 'shared', CANARY),
        volunteer('vol-theirs', 'theirs', STELLR_TENANT_ID),
        rosterRow('coh-stellr', 'cohort-stellr'),
        rosterRow('coh-canary', 'cohort-canary'),
        rosterRow('coh-on-theirs', 'cohort-on-theirs'),
      ],
      training_modules: [{ id: 'module', remind_inapp: true, remind_email: true, remind_sms: false, remind_2wk: false, remind_1wk: true, remind_2d: false, remind_1d: true, escalate_supervisor: true, ...STELLR }],
      training_items: [{ id: 'item', module_id: 'module', status: 'published' }],
      training_progress: [],
      member_memberships: [],
      registrations: [
        registration('stellr', STELLR), registration('unstamped', NO_TENANT), registration('canary', OTHER),
        { id: 'reg-shared-stellr', event_slug: 'shared', teacher_email: null, teacher_first_name: null, ...NO_TENANT },
        { id: 'reg-shared-canary', event_slug: 'shared', teacher_email: null, teacher_first_name: null, ...OTHER },
        // Another tenant's registration on the event a Stellr assignment names.
        { id: 'reg-crossed', event_slug: 'stellr', teacher_email: null, teacher_first_name: null, ...OTHER },
        // No tenant yet, on another tenant's event: only the event can rule it out.
        { id: 'reg-theirs', event_slug: 'theirs', teacher_email: null, teacher_first_name: null, ...NO_TENANT },
      ],
      participants: [
        person('stellr'), person('unstamped'), person('canary'),
        { registration_id: 'reg-shared-stellr', member_id: 'm-shared-stellr', first_name: 'A', last_name: 'B', event_role: 'student' },
        { registration_id: 'reg-shared-canary', member_id: 'm-shared-canary', first_name: 'A', last_name: 'B', event_role: 'student' },
        { registration_id: 'reg-crossed', member_id: 'm-crossed', first_name: 'A', last_name: 'B', event_role: 'student' },
        { registration_id: 'reg-theirs', member_id: 'm-theirs', first_name: 'A', last_name: 'B', event_role: 'student' },
      ],
      members: [],
      ...overrides,
    })
    return { db, log }
  }

  it('reminds on Stellr and NULL assignments, registrations, volunteers and cohorts, and not on another tenant', async () => {
    const { runTrainingReminders } = await import('@/lib/training-reminders')
    const { db, log } = trainingTables()
    h.db = db

    const result = await runTrainingReminders()

    const claims = log.filter((l) => l.table === 'sent_reminders' && l.method === 'POST').map((l) => l.body as Row)
    expect(claims.map((c) => c.member_id).sort()).toEqual([
      'coh-stellr', 'm-shared-stellr', 'm-stellr', 'm-unstamped', 'vol-shared', 'vol-shared-unstamped',
    ])
    expect(claims.map((c) => c.ref_id).sort()).toEqual(['a-stellr', 'a-unstamped', 'obj', 'obj', 'obj', 'obj-cohort'])
    expect(result.reminded).toBe(6)
  })

  it('tells the cohort mentor about overdue training only on a Stellr cohort', async () => {
    const { runTrainingReminders } = await import('@/lib/training-reminders')
    const overdue = '2026-11-01T12:00:00.000Z'
    const { db } = trainingTables({
      training_assignments: [],
      course_object_assignments: [
        objectAssignment('obj-cohort', 'cohort', 'cohort-stellr', overdue),
        objectAssignment('obj-cohort-canary', 'cohort', 'cohort-canary', overdue),
        objectAssignment('obj-cohort-on-theirs', 'cohort', 'cohort-on-theirs', overdue),
      ],
    })
    h.db = db

    const result = await runTrainingReminders()

    expect(result.escalated).toBe(1)
    expect(h.notifyMember.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['mentor'])
  })

  it('stops before the per-Object pass when it cannot tell whose events are whose', async () => {
    const { runTrainingReminders } = await import('@/lib/training-reminders')
    const { db, log } = trainingTables({ training_assignments: [] }, { failing: ['events'] })
    h.db = db

    await expect(runTrainingReminders()).rejects.toThrow('events is unavailable')
    expect(log.filter((l) => l.table === 'sent_reminders' && l.method === 'POST')).toEqual([])
  })

  it('leaves the admin Volunteers panel as wide as it was', async () => {
    const { eventVolunteers } = await import('@/lib/training-audience')
    const { db } = trainingTables()
    const wide = await eventVolunteers(db, 'shared')
    const narrow = await eventVolunteers(db, 'shared', { stellrOnly: true })
    expect(wide.map((v) => v.memberId)).toEqual(['vol-shared', 'vol-shared-unstamped', 'vol-shared-canary'])
    expect(narrow.map((v) => v.memberId)).toEqual(['vol-shared', 'vol-shared-unstamped'])
  })
})

describe('docusign-form-data', () => {
  it('reads opt-outs off Stellr and NULL agreements and not another tenant', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
    vi.stubEnv('CRON_SECRET', 'test-secret')
    const row = (id: string, tenant: Row) => ({
      id, envelope_type: 'minor', status: 'completed', reused_from: null, form_opt_outs: null, completed_at: '2026-11-01T00:00:00Z', ...tenant,
    })
    h.db = standIn({ agreements: [row('stellr', STELLR), row('unstamped', NO_TENANT), row('canary', OTHER)] }).db
    const { GET } = await import('@/app/api/cron/docusign-form-data/route')

    const res = await GET(new Request('https://app.example.org/api/cron/docusign-form-data', {
      headers: { authorization: 'Bearer test-secret' },
    }) as never)

    expect(res.status).toBe(200)
    const ids = (h.recordOptOut.mock.calls as unknown as Array<[unknown, { id: string }]>).map((c) => c[1].id)
    expect(ids).toEqual(['stellr', 'unstamped'])
  })
})

describe('hubspot-event-options', () => {
  // lib/hubspot-event-options.test.ts covers what the option does; this is the wiring.
  it('asks the sync to leave out events another tenant owns', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
    vi.stubEnv('CRON_SECRET', 'test-secret')
    const { db } = standIn({})
    h.db = db
    const { GET } = await import('@/app/api/cron/hubspot-event-options/route')

    const res = await GET(new Request('https://app.example.org/api/cron/hubspot-event-options', {
      headers: { authorization: 'Bearer test-secret' },
    }) as never)

    expect(res.status).toBe(200)
    expect(h.syncEventOptions.mock.calls[0][0].stellrOnlyDb).toBe(db)
  })
})

describe('membership-expiry consent purge', () => {
  // The other way round from the rest: a hold must keep seeing every tenant.
  it('holds an account whose only other record belongs to another tenant', async () => {
    const { purgeUnconsentedAccounts } = await import('@/lib/pending-consent')
    const deleteMember = vi.fn(async () => {})
    const { db, log } = standIn({
      member_pending_consent: [{ member_id: 'm1', consented_at: null, purge_after: '2026-01-01T00:00:00Z', next_attempt_at: null }],
      members: [{ id: 'm1', account_invite_sent_at: null }],
      participants: [],
      agreements: [{ id: 'a1', member_id: 'm1', envelope_type: 'minor', event_slug: 'theirs', status: 'sent', participant_id: null, ...OTHER }],
      agreement_recipients: [],
    })

    const result = await purgeUnconsentedAccounts(db, { now: NOW, deleteMember })

    expect(result.heldAdultRoute).toEqual(['m1'])
    expect(deleteMember).not.toHaveBeenCalled()
    expect(log.some((l) => l.url.search.includes('tenant_id'))).toBe(false)
  })
})
