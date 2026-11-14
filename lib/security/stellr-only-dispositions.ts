// Where each stellr_only id-bearing route is going (multi-tenant plan S5, slice C6).
//
// PROPOSED, NOT DECIDED. The owner approves this register, as a gate on C16 and later
// (docs/TENANCY-S5.md, Owner gates). Until then it records the area analysis's reading
// and changes nothing: routes keep their stellr_only guard, and only tests import this.
// Questions it leaves with the owner:
//   - whether scholarships stay stellr_only for release 1. They are listed
//     tenant_destined because their table is event-scoped, but tenants have none yet;
//   - whether training/assignments and training/tracking are release-1 tenant features.
//     They are listed permanent;
//   - for each platform_destined route, whether it becomes owner-only or stays usable
//     by Stellr staff. C15 moved the class and not the guard, so that choice is still open.
//     So is the audit chain that goes with it: these routes write to Stellr's chain until
//     the owner has answered, and a row on the wrong chain cannot be corrected, so the
//     answer comes before PLATFORM_AUDIT_ENABLED is on with a second tenant.
//
//   tenant_destined    moves to tenant_crew on loadScoped; MAX_TENANT_DESTINED_STELLR_ONLY
//                      in test/idor/stellr-only-dispositions.test.ts falls with each one
//   platform_destined  a platform function by nature: classed platform_destined in the
//                      manifest (C15), guard unchanged. Once the owner has chosen, a route
//                      goes to platform_admin or back to stellr_only, and leaves this list
//   permanent          a Stellr product; tenants never hold it
//   until_s7_identity  identity tables: stays until tenant profiles exist (S7)
//
// The suite fails on a stellr_only or platform_destined id-bearing route not listed here,
// and on an entry that is no longer one, so a new route must be placed and a converted one
// must leave. The manifest's platform_destined class and this file's must also be the same
// routes.

export type StellrOnlyDisposition = 'tenant_destined' | 'platform_destined' | 'permanent' | 'until_s7_identity'

/** Set to 'approved', with the date, only on the owner's word. */
export const DISPOSITION_REGISTER_STATUS: { status: 'proposed' | 'approved'; approvedOn: string | null } = {
  status: 'proposed',
  approvedOn: null,
}

interface DispositionGroup {
  disposition: StellrOnlyDisposition
  /** The PR expected to convert the group, where the plan names one. */
  convertedBy?: string
  reason: string
  /** Paths under app/api/admin, without /route.ts. */
  routes: readonly string[]
}

const GROUPS: readonly DispositionGroup[] = [
  {
    disposition: 'tenant_destined',
    convertedBy: 'C19',
    reason: 'event operations by slug: a tenant runs its own events. C18 moved companies, offerings and merch/commit',
    routes: [
      'events/[slug]/awards', 'events/[slug]/awards/issue',
      'events/[slug]/badge-templates', 'events/[slug]/badge-templates/preview', 'events/[slug]/badges',
      'events/[slug]/certificate-templates', 'events/[slug]/certificate-templates/preview', 'events/[slug]/certificates',
      'events/[slug]/check-in', 'events/[slug]/credentials',
    ],
  },
  {
    disposition: 'tenant_destined',
    convertedBy: 'C21',
    reason: 'assigning event managers: C16 moved its check to lib/authz and left it on the Stellr admin guard until roles are settled',
    routes: ['event-managers'],
  },
  {
    disposition: 'tenant_destined',
    convertedBy: 'C20',
    reason: 'an event-scoped table; the owner to confirm whether tenants get scholarships in release 1',
    routes: [
      'scholarships/[id]', 'scholarships/[id]/cancel', 'scholarships/[id]/not-offered', 'scholarships/[id]/offer',
      'scholarships/[id]/refund', 'scholarships/[id]/refund-quote', 'scholarships/[id]/resend',
    ],
  },
  {
    disposition: 'platform_destined',
    reason: 'acts across tenants by nature: the owner decides, route by route, owner-only or Stellr crew',
    routes: [
      'deletion', 'deletion-requests/[id]', 'deletion/preflight', 'events/slug-guard', 'impersonation', 'members/merge',
      'privacy-requests/[id]', 'schools/[id]', 'duties',
    ],
  },
  {
    disposition: 'until_s7_identity',
    reason: 'touches identity tables; tenant crew see the participant under their event until S7 tenant profiles',
    routes: [
      'members', 'members/[id]', 'members/[id]/access', 'members/[id]/activity', 'members/[id]/background-check',
      'members/[id]/background-check/adjudicate', 'members/[id]/background-check/report', 'members/[id]/event-manager', 'members/[id]/staff',
      'members/[id]/event-participations', 'members/[id]/external-check', 'members/[id]/invite', 'members/[id]/license', 'members/[id]/license/document', 'members/[id]/memberships',
      'members/[id]/memberships/[membershipId]', 'members/[id]/spaces', 'members/[id]/volunteer', 'members/[id]/volunteer-agreement',
    ],
  },
  {
    disposition: 'permanent',
    reason: 'community and access are Stellr-only under the Social Media Minimum Age guardrail (plan decision 12)',
    routes: [
      'access/objects', 'access/objects/[id]', 'access/objects/[id]/contents', 'access/objects/[id]/gates',
      'access/objects/[id]/managers', 'access/objects/[id]/roster', 'access/people/[id]', 'coaching', 'coaching/requests/[id]/decline',
      'coaching/requests/[id]/match', 'community/coaching', 'community/flags', 'community/gates', 'community/mentoring',
      'community/resources', 'community/spaces', 'community/spaces/[id]', 'community/spaces/[id]/members',
      'community/spaces/[id]/resources', 'community/training/cert-template', 'community/training/items',
      'community/training/modules', 'community/training/recording', 'community/training/resources',
      'community/training/sections', 'containers/[id]/contents',
    ],
  },
  {
    disposition: 'permanent',
    reason: "Stellr's own products and templates: email campaigns, store, entitlements, membership, training, certificates, e-sign templates",
    routes: [
      'artwork-defaults/[theme]/badge-templates', 'artwork-defaults/[theme]/badge-templates/preview',
      'artwork-defaults/[theme]/certificate-templates', 'artwork-defaults/[theme]/certificate-templates/preview',
      'email/audience/preview', 'email/campaigns', 'email/campaigns/[id]', 'email/campaigns/[id]/test', 'email/templates',
      'email/templates/[id]', 'entitlements/allocations', 'entitlements/discounts', 'esign/templates', 'esign/templates/[id]/approve',
      'esign/templates/[id]/preview', 'esign/templates/file', 'esign/templates/preview', 'membership/rules', 'pd-certificate',
      'pd-certificate/preview', 'store/discounts', 'store/products/[id]', 'store/products/[id]/sync', 'store/products/[id]/variants',
      'training/assignments', 'training/bulk-notify', 'training/cert-preview', 'training/live-room', 'training/tracking',
      'staff-settings',
    ],
  },
]

export interface DispositionEntry {
  disposition: StellrOnlyDisposition
  reason: string
  convertedBy?: string
}

/** Route file (as keyed in ROUTE_MANIFEST) to its proposed disposition. */
export const STELLR_ONLY_DISPOSITIONS: Readonly<Record<string, DispositionEntry>> = Object.fromEntries(
  GROUPS.flatMap(({ routes, ...entry }) => routes.map((r) => [`app/api/admin/${r}/route.ts`, entry])),
)

export function dispositionCounts(entries: Readonly<Record<string, DispositionEntry>> = STELLR_ONLY_DISPOSITIONS): Record<StellrOnlyDisposition, number> {
  const counts: Record<StellrOnlyDisposition, number> = { tenant_destined: 0, platform_destined: 0, permanent: 0, until_s7_identity: 0 }
  for (const e of Object.values(entries)) counts[e.disposition]++
  return counts
}
