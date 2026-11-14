// What each cron is allowed to touch once a second tenant exists (S5 B3). Data
// only, and nothing reads it at runtime yet; test/cron-scope.test.ts keeps it
// the same set as app/api/cron and vercel.json, so a new cron has to be
// classified when it is added.
//
//   per_tenant   works over event data that belongs to any tenant; moves onto
//                runPerTenant (lib/cron-tenants.ts) in B13, B14 and B22
//   stellr_only  Stellr's own products, integrations or staff inbox; limited to
//                Stellr data where it reads event-scoped tables (B11, stellrRows
//                in lib/tenancy/stellr-scope.ts). Rows with a NULL tenant_id
//                count as Stellr's
//   platform     operates the platform itself, not any tenant's data
//
// Three more things the classification alone does not say:
//
//   identityAudience  the cron picks people to contact or grant to from
//                     public.members, which is shared across tenants, with no
//                     tenant limit. stellr_only states where it should end up, not
//                     what it does today. B11 deliberately leaves these reads as
//                     they are: members has no tenant column for stellrRows to
//                     filter on, and who counts as Stellr's member is the open owner
//                     decision (docs/TENANCY-S5.md, B3). It must be settled before
//                     the first non-owner event. test/cron-scope.test.ts pins the
//                     list.
//   identityRead      the cron reads public.members for a reason other than picking
//                     an audience, and that read stays as wide as it is today. The
//                     text says why.
//   inactiveTenants   'run' means B13 passes includeInactive to runPerTenant, so
//                     suspended and archived tenants are still reached.

export type CronScope = 'per_tenant' | 'stellr_only' | 'platform'

export interface CronScopeEntry {
  scope: CronScope
  why: string
  identityAudience?: string
  identityRead?: string
  inactiveTenants?: 'run'
}

export const CRON_SCOPES: Readonly<Record<string, CronScopeEntry>> = {
  'alumni-upgrades': {
    scope: 'stellr_only',
    why: 'Stellr membership tiers',
    identityAudience: 'every member with a graduation year gets a Stellr Alumni grant and a notice',
  },
  'apollo-reconcile': { scope: 'stellr_only', why: "Stellr's Apollo and HubSpot accounts" },
  'background-sync': { scope: 'stellr_only', why: 'Checkr is Stellr-only; reads participants and registrations (B11)' },
  'campaign-drip': {
    scope: 'stellr_only',
    why: 'Stellr marketing email',
    identityAudience: 'campaign audience is every consenting member',
  },
  'campaign-events': {
    scope: 'stellr_only',
    why: 'Stellr marketing email',
    identityAudience: 'campaign audience is every consenting member',
  },
  campaigns: {
    scope: 'stellr_only',
    why: 'Stellr marketing email',
    identityAudience: 'campaign audience is every consenting member',
  },
  'deletion-archive-retention': { scope: 'platform', why: 'retention of the platform deletion archive' },
  'docusign-form-data': { scope: 'stellr_only', why: 'DocuSign is Stellr-only; reads agreements (B11)' },
  'docusign-reminders': { scope: 'per_tenant', why: 'native e-sign reminders (B14); the DocuSign part stays Stellr-only' },
  entitlements: { scope: 'platform', why: 'entitlement lifecycle and the daily platform error digest' },
  'event-emails': { scope: 'per_tenant', why: 'event emails for any tenant (B14)' },
  'group-invoice-sync': {
    scope: 'per_tenant',
    why: "a group's own unpaid invoice, for any tenant (B22); another tenant's rows are held until S9 brings priced tenant events",
  },
  'hubspot-event-options': { scope: 'stellr_only', why: "Stellr's HubSpot; syncs only Stellr events (B11)" },
  'hubspot-lifecycle': { scope: 'stellr_only', why: "Stellr's HubSpot" },
  'email-outbox': {
    scope: 'platform',
    why: 'resends mail Resend refused for its quota or an outage; every message was already addressed by the sender that queued it',
  },
  'lead-capture-failures': { scope: 'stellr_only', why: "Stellr's lead capture" },
  'membership-expiry': {
    scope: 'stellr_only',
    why: 'Stellr membership and pending consent',
    identityRead:
      'the consent purge has no event-scoped work list. Its participants and agreements reads only hold an account back from deletion, so they keep counting every tenant: limiting them would delete a person another tenant still holds records for',
  },
  'motion-bookings': { scope: 'stellr_only', why: "Stellr's calendar and HubSpot" },
  'session-reminders': { scope: 'stellr_only', why: 'Stellr coaching sessions' },
  'survey-retention': {
    scope: 'per_tenant',
    why: 'survey data of any tenant (B13)',
    inactiveTenants: 'run',
  },
  surveys: { scope: 'per_tenant', why: 'post-event surveys of any tenant (B13)' },
  'team-profiles': { scope: 'per_tenant', why: 'team profiles of any tenant (B13)' },
  'training-reminders': { scope: 'stellr_only', why: "Stellr training; reads event-scoped assignments, and skips another tenant's events and cohorts (B11)" },
  'weekly-digest': {
    scope: 'stellr_only',
    why: "Stellr's admin digest; event-scoped reads limited to Stellr (B11)",
    identityRead:
      'new and departed members, new mentors and the verification queue come from members, so a tenant registrant with a member record would be counted. Same owner decision as identityAudience. Reactions name no Space, so they count every tenant too',
  },
}
