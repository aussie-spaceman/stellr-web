// Where a member adds their teaching license: the "Background Check & License"
// card (components/member/ComplianceSection, id="clearance") on the Profile tab
// of /account. The account page picks its tab from ?tab=; profile is already the
// default, but naming it keeps the link right if that default ever changes.
// Dependency-free so the client-side notification bell can import it.
export const CLEARANCE_PATH = '/account?tab=profile#clearance'
