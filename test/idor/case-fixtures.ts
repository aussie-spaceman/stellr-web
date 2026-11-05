// Per-route fixtures for the generated IDOR suite: what a case needs so its
// Canary id reaches the code that decides, instead of stopping at request
// validation (`unexercised`) or an unconfigured integration (`error`).
//
// A fixture may only get the request further. It never decides an outcome:
//   - `body` is sent under the id inputs, so a fixture cannot replace a honeytoken;
//   - `inputs` swaps an id input for a real value only where the input names no
//     tenant record (a static page key), and every other id input stays Canary;
//   - `callerRows` and `member` are the CALLER'S own rows, so a filter scoped to
//     the caller finds them. The honey row still answers every filter that is
//     not scoped to an identity;
//   - `honey` sets non-identity columns on the honey row (a registration's type),
//     so a route reaches its ownership check instead of stopping on the row's
//     shape. It cannot change who the row belongs to: filters read identity
//     columns from the row's own model, not from these values.
// The outcome is still classified by test/idor/harness.ts and pinned in the
// snapshot. Nothing here reads a real credential: every env value is a dummy
// and the network stays closed (`fetch` answers only the URLs a fixture names).
// test/idor/case-fixtures.test.ts holds these rules as allow-lists.
//
// A fixture that reaches a Canary write is not accepted into the snapshot. It
// goes in HELD_BACK_FIXTURES, and the route stays pinned as it was until its owner
// fixes it.
//
// Not here: register/group and register/individual. This suite models no Sanity event,
// so a fixture would only move them to a 404 no id caused. They stay pinned for Lane A.
// test/idor/tenant-host-targets.ts has the bodies that reach the event, where a slug
// does answer.

export interface CaseFixture {
  /** What the route stopped on without this fixture. */
  reason: string
  /** Limit the fixture to these methods; every method when omitted. */
  methods?: string[]
  /** Non-id body fields, sent under the generated id inputs. */
  body?: Record<string, unknown>
  /** Id inputs that name no tenant record: their real value, replacing the honeytoken. */
  inputs?: Record<string, string>
  /** Dummy configuration, set while the route loads and runs, then restored. */
  env?: Record<string, string>
  /** The caller's own rows, by table (a licence the route requires, say). */
  callerRows?: Record<string, Record<string, unknown>[]>
  /** Merged into the caller's `members` row. */
  member?: Record<string, unknown>
  /** Non-identity columns of the honey row, where a route branches on its shape first. */
  honey?: Record<string, unknown>
  /** Answer Stripe's create calls (test/idor/harness.ts stripeMock) instead of rejecting them. */
  stripe?: boolean
  /** Answer outbound requests to these integrations instead of the harness's 503. */
  fetch?: (url: string) => Response | undefined
  /**
   * Set only when a refusal is a real decision made before any query (a signature
   * check, a string compare on the id): what decides. Without it, a `refused` that
   * used no Canary value fails test/idor/idor-routes.test.ts.
   */
  refusesWithoutQuery?: string
  /** Further values the honey row's token columns answer to (a valid link's hash). Tenant-host cases only. */
  honeyTokens?: readonly string[]
  /** Cookies the request carries (a signing session). Tenant-host cases only. */
  cookies?: Record<string, string>
  /** Extra request headers (x-sign-ref). Tenant-host cases only. */
  headers?: Record<string, string>
  /** What a named rpc answers, where a route stops unless it says yes. Tenant-host cases only. */
  rpcAnswers?: Record<string, unknown>
  /** Send no Origin header, as a caller outside a browser may. Tenant-host cases only. */
  omitOrigin?: boolean
  /**
   * Generated body inputs to leave out, where another one is what the case tests (a
   * registration for host B's event, with no offer or school of host B's). Tenant-host
   * cases only.
   */
  omitInputs?: readonly string[]
  /**
   * For a staff persona on a tenant_staff route that really cannot get to the id: why.
   * staffCaseProblem in test/idor/harness.ts refuses the case otherwise.
   */
  staffUnproven?: Partial<Record<'stellr_staff' | 'canary_admin' | 'stellr_event_manager', string>>
}

const STRIPE_ENV = { STRIPE_SECRET_KEY: 'sk_test_x' }
const STRIPE_MEMBER = { stripe_customer_id: 'cus_idorharness' }
// lib/gated-download-link.ts refuses a secret under 32 characters.
const DUMMY_SECRET = 'x'.repeat(32)
const SIGNING_ENV = { ASSET_LINK_SECRET: DUMMY_SECRET }
const STRIPE_CHECKOUT = { env: STRIPE_ENV, member: STRIPE_MEMBER, stripe: true }
/** HubSpot's forms endpoint, the one lead-capture write that needs no token. */
const hubspotForms = (url: string) => (url.startsWith('https://api.hsforms.com/') ? Response.json({ inlineMessage: 'ok' }) : undefined)

export const CASE_FIXTURES: Record<string, CaseFixture> = {
  // ── request shape: enums and zod bodies ────────────────────────────────────
  'app/api/community/cohorts/respond/route.ts': {
    reason: 'action must be accept or decline',
    body: { action: 'accept' },
  },
  'app/api/community/spaces/invite/respond/route.ts': {
    reason: 'action must be accept or decline',
    body: { action: 'accept' },
  },
  'app/api/community/sessions/actions/route.ts': {
    reason: 'done must be a boolean',
    body: { done: true },
  },
  'app/api/community/comments/route.ts': {
    reason: 'bodyJson must be a Tiptap document with text, and only a published post goes on to the access check',
    honey: { status: 'published' },
    body: { bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'IDOR harness reply' }] }] } },
  },
  'app/api/community/posts/route.ts': {
    reason: "PATCH only accepts action 'toggle-announcement'",
    methods: ['PATCH'],
    body: { action: 'toggle-announcement' },
  },
  'app/api/credentials/[number]/visibility/route.ts': {
    reason: 'visibility must be public or private',
    body: { visibility: 'private' },
  },
  'app/api/members/deletion-requests/route.ts': {
    reason: 'entity must be one a member can request',
    body: { entity: 'event_participation' },
  },

  // ── caller-owned twin rows: the route reads the caller's row first ─────────
  'app/api/members/compliance/document/route.ts': {
    reason: 'the route needs the caller to hold a licence row before it looks at the path',
    refusesWithoutQuery: 'the storage path must start with the caller’s member id',
    methods: ['POST'],
    callerRows: {
      member_teacher_licenses: [
        { id: '00000000-0000-4000-8000-00000000a002', member_id: '00000000-0000-4000-8000-00000000a001', document_path: null },
      ],
    },
  },

  // ── lead capture: the email is the input under test, not the other fields ──
  'app/api/asset-request/route.ts': {
    reason: 'asset is a static key and the download link needs a signing secret',
    body: { asset: 'space-rfp-2026' },
    env: SIGNING_ENV,
  },
  'app/api/white-paper/route.ts': {
    reason: 'the download link needs a signing secret',
    env: SIGNING_ENV,
  },
  'app/api/lp-lead/route.ts': {
    reason: 'role, consent and students have fixed shapes; pageSlug is a static page key, not a tenant record',
    body: { role: 'teacher', consent: true, students: 10, audience: 'teachers' },
    inputs: { pageSlug: 'first-robotics-teachers' },
  },
  'app/api/teacher-grant/route.ts': {
    reason: 'every answer is validated by shape',
    body: {
      yearsTeaching: '5',
      priorStellr: 'no',
      firstName: 'Idor',
      lastName: 'Harness',
      schoolName: 'IDOR Harness School',
      schoolCity: 'Denver',
      schoolState: 'CO',
      subjects: 'Science',
      dateOfBirth: '1980-01-01',
      gender: 'Other',
      plannedActivities: 'challenge',
      expectedStudents: '25',
      motivation: 'IDOR harness motivation text, long enough to pass the forty character minimum.',
      consent: true,
      acknowledgePayment: true,
      website: '',
    },
  },

  // ── unconfigured integrations: dummy env, so the id reaches the check ──────
  'app/api/webhooks/apollo/route.ts': {
    reason: 'APOLLO_WEBHOOK_SECRET unset answers 503 before the signature check',
    refusesWithoutQuery: 'the signature check, which comes before the event is read',
    env: { APOLLO_WEBHOOK_SECRET: DUMMY_SECRET },
  },
  'app/api/registrations/[id]/spreadsheet/route.ts': {
    reason: 'Google env is checked before auth, and a non-group row stops before the ownership check',
    honey: { type: 'group' },
    env: {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'idor-harness@example.invalid',
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: DUMMY_SECRET,
    },
  },
  'app/api/community/coaching/topup/route.ts': {
    reason: 'Stripe unset answers 503 before checkout',
    ...STRIPE_CHECKOUT,
  },
  'app/api/store/reship/route.ts': {
    reason: 'Stripe unset answers 503 before the order is read',
    ...STRIPE_CHECKOUT,
  },
  'app/api/subscribe/route.ts': {
    reason:
      "HubSpot answering 503 made a 502 before any answer; source 'event-notify' sends eventSlug on. With no Sanity client the slug stays unresolved, so this proves only that the caller's own slug is passed along",
    body: { source: 'event-notify' },
    env: { HUBSPOT_FORM_EVENT_NOTIFY: 'idor-harness-form' },
    fetch: hubspotForms,
  },
}

/**
 * A fixture that gets the Canary id through to a write. Not an accepted outcome:
 * the snapshot keeps the route as it was (`unexercised` or `error`), and
 * test/idor/idor-routes.test.ts proves the write still happens. When the route is
 * fixed that test fails: move the fixture to CASE_FIXTURES and run
 * `npm run idor:snapshot`.
 */
export interface HeldBackFixture {
  method: string
  /** The entry in the maintainer's private tracker: its owner and fix. */
  ref: string
  /** Where the Canary value lands (honey-db table, or the Stripe call). */
  writes: string[]
  fixture: CaseFixture
  /**
   * Set when the route has a rule of its own and the case stays held back: the honey
   * columns that make that rule refuse. idor-routes.test.ts proves the same case then
   * comes back `refused`, so the rule is pinned apart from the held-back outcome.
   */
  refusedWhen?: Record<string, unknown>
}

// C4-F1, C4-F2, C4-F3: the routes follow what the member can see, and refuse a
// private Space or an archived cohort. An open Space and an open cohort are open to
// every member, and no tenant column tells a Canary row from a real one. These stay
// held back until B9 keeps community on Stellr.
const CANARY_OPEN_SPACE_POST = { status: 'published', is_archived: false, access_type: 'open' }

export const HELD_BACK_FIXTURES: Record<string, HeldBackFixture> = {
  'app/api/community/flag/route.ts': {
    method: 'POST',
    ref: 'C4-F1',
    writes: ['community_flags'],
    refusedWhen: { access_type: 'private' },
    fixture: {
      reason: 'contentType is a zod enum, and only a published post in a live Space goes on to the access check',
      honey: CANARY_OPEN_SPACE_POST,
      body: { contentType: 'post' },
    },
  },
  'app/api/community/reactions/route.ts': {
    method: 'POST',
    ref: 'C4-F2',
    writes: ['community_reactions'],
    refusedWhen: { access_type: 'private' },
    fixture: {
      reason: 'targetType is a zod enum, and only a published post in a live Space goes on to the access check',
      honey: CANARY_OPEN_SPACE_POST,
      body: { targetType: 'post' },
    },
  },
  'app/api/community/mentoring/register/route.ts': {
    method: 'POST',
    ref: 'C4-F3',
    writes: ['stripe.checkout.sessions.create'],
    refusedWhen: { lifecycle: 'archived' },
    fixture: { reason: 'Stripe unset answers 503 on the paid path, after the cohort is read', ...STRIPE_CHECKOUT },
  },
  'app/api/credentials/[number]/events/route.ts': {
    method: 'POST',
    ref: 'C4-F4',
    writes: ['credential_events'],
    fixture: { reason: 'kind is an allow-list of share events', body: { kind: 'copy_link' } },
  },
  // Still held. The route already orders only an active variant of an active product
  // (pinned in its route.test.ts). The honey row is both, and the catalogue has no
  // tenant column, so no check can tell it from a real one until the owner decides
  // whether the catalogue gets a tenant or this outcome is accepted with a reason.
  'app/api/store/checkout/route.ts': {
    method: 'POST',
    ref: 'C4-F5',
    writes: ['store_order_items'],
    fixture: { reason: 'Stripe unset answers 503 before the variants are read', ...STRIPE_CHECKOUT },
  },
  'app/api/members/onboarding/route.ts': {
    method: 'POST',
    ref: 'C4-F6',
    writes: ['member_schools', 'community_notifications'],
    fixture: {
      reason: 'the date of birth, role and contact fields are validated before school_id is used',
      body: {
        event_role: 'teacher',
        age_bracket: 'adult',
        date_of_birth: '1980-01-01',
        gender: 'prefer_not_to_say',
        phone: '5550100',
        grade: '10',
        tshirt_size: 'M',
        ec_first_name: 'Idor',
        ec_last_name: 'Contact',
        ec_phone: '5550101',
        ec_relationship: 'Parent',
      },
    },
  },
}

/** The fixture a route's case runs with, for this method. */
export function fixtureFor(fixture: CaseFixture | undefined, method: string): CaseFixture | undefined {
  if (!fixture) return undefined
  return !fixture.methods || fixture.methods.includes(method) ? fixture : undefined
}

/** Sets dummy env, returning the function that puts the previous values back. */
export function applyEnv(env: Record<string, string> | undefined): () => void {
  if (!env) return () => {}
  const previous = Object.keys(env).map((k) => [k, process.env[k]] as const)
  Object.assign(process.env, env)
  return () => {
    for (const [k, v] of previous) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}
