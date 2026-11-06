// What each cron is allowed to touch once a second tenant exists (S5 B3). Data
// only, and nothing reads it at runtime yet; test/cron-scope.test.ts keeps it
// the same set as app/api/cron and vercel.json, so a new cron has to be
// classified when it is added.
//
//   per_tenant   works over event data that belongs to any tenant; moves onto
//                runPerTenant (lib/cron-tenants.ts) in B13 and B14
//   stellr_only  Stellr's own products, integrations or staff inbox; limited to
//                Stellr data where it reads event-scoped tables (B11)
//   platform     operates the platform itself, not any tenant's data
//
// Two more things the classification alone does not say:
//
//   identityAudience  the cron picks people from public.members, which is shared
//                     across tenants, with no tenant limit. stellr_only states
//                     where it should end up, not what it does today, and B11's
//                     event-table limits do not touch this read. No slice claims
//                     it yet; test/cron-scope.test.ts pins the list.
//   inactiveTenants   'run' means B13 passes includeInactive to runPerTenant, so
//                     suspended and archived tenants are still reached.

export type CronScope = 'per_tenant' | 'stellr_only' | 'platform'

export interface CronScopeEntry {
  scope: CronScope
  why: string
  identityAudience?: string
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
  'group-invoice-sync': { scope: 'per_tenant', why: "a group's own unpaid invoice, for any tenant" },
  'hubspot-event-options': { scope: 'stellr_only', why: "Stellr's HubSpot; syncs only Stellr events (B11)" },
  'hubspot-lifecycle': { scope: 'stellr_only', why: "Stellr's HubSpot" },
  'lead-capture-failures': { scope: 'stellr_only', why: "Stellr's lead capture" },
  'membership-expiry': { scope: 'stellr_only', why: 'Stellr membership; reads pending consent (B11)' },
  'motion-bookings': { scope: 'stellr_only', why: "Stellr's calendar and HubSpot" },
  'session-reminders': { scope: 'stellr_only', why: 'Stellr coaching sessions' },
  'survey-retention': {
    scope: 'per_tenant',
    why: 'survey data of any tenant (B13)',
    inactiveTenants: 'run',
  },
  surveys: { scope: 'per_tenant', why: 'post-event surveys of any tenant (B13)' },
  'team-profiles': { scope: 'per_tenant', why: 'team profiles of any tenant (B13)' },
  'training-reminders': { scope: 'stellr_only', why: 'Stellr training; reads event-scoped assignments (B11)' },
  'weekly-digest': { scope: 'stellr_only', why: "Stellr's staff digest; reads event-scoped tables (B11)" },
}
