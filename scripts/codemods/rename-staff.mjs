/**
 * rename-staff.mjs: the one-off rename that freed the word "staff" (13 Nov 2026).
 *
 * Before it, "staff" meant four things, none of them the Staff role:
 *   - staff_roles and its scopes      → Duties   (admin_duties, DUTY_SCOPES, /admin/duties)
 *   - tenant_role 'staff'             → 'duty_holder'   (by hand, not here)
 *   - "admin or event manager"        → crew     (requireEventCrew, tenant_crew, isCrewTarget)
 *   - desk check-ins of mentors/EMs   → crew     (event_crew_check_ins, crew_key)
 *   - the shared alert inbox          → team inbox (teamInboxEmail, alertTeam)
 * member_role_type 'staff' keeps its name: it now mirrors the Staff role.
 *
 * What it does, in order:
 *   1. moves the files whose names say staff;
 *   2. rewrites compound tokens (isStaffTarget, staff_roles, check-in-staff,
 *      CANARY:staff-…) everywhere in the given files, comments included, so
 *      prose that names code stays true;
 *   3. renames the bare identifiers staff / Staff / STAFF (never comments or
 *      strings) to crew, or to duties where they hold staff_roles rows.
 * Bare "staff" in strings, JSX and comments is left for review by hand:
 * `npm run lint:staff-word` lists what is left.
 *
 *   node scripts/codemods/rename-staff.mjs            # dry run: counts
 *   node scripts/codemods/rename-staff.mjs --write
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'

const WRITE = process.argv.includes('--write')

/** git mv, old → new. */
export const MOVES = [
  ['app/(stellr)/(admin)/admin/staff', 'app/(stellr)/(admin)/admin/duties'],
  ['app/api/admin/staff-roles', 'app/api/admin/duties'],
  ['components/admin/StaffRolesManager.tsx', 'components/admin/DutiesManager.tsx'],
  ['lib/check-in-staff.ts', 'lib/check-in-crew.ts'],
  ['lib/check-in-staff.test.ts', 'lib/check-in-crew.test.ts'],
]

/** Specific renames, tried longest first, before the generic staff → crew. */
export const SPECIFIC = [
  // Duties: the old staff_roles scopes.
  ['scholarshipStaffAlertEmail', 'scholarshipTeamInboxEmail'],
  ['staffAudienceMemberIds', 'dutyAudienceMemberIds'],
  ['staffAudienceEmails', 'dutyAudienceEmails'],
  ['staffAudience', 'dutyAudience'],
  ['StaffRolesManager', 'DutiesManager'],
  ['AdminStaffPage', 'AdminDutiesPage'],
  ['loadHoldsStaffRow', 'loadHoldsDutyRow'],
  ['targetHoldsStaffRow', 'targetHoldsDutyRow'],
  ['holdsStaffRow', 'holdsDutyRow'],
  ['syncStaffGranted', 'syncDutyGranted'],
  ['syncStaffRevoked', 'syncDutyRevoked'],
  ['grantStaffRole', 'grantDuty'],
  ['revokeStaffRole', 'revokeDuty'],
  ['loadStaffScopes', 'loadDutyScopes'],
  ['STAFF_SCOPES', 'DUTY_SCOPES'],
  ['StaffScope', 'DutyScope'],
  ['staffScopes', 'dutyScopes'],
  ['staffScope', 'dutyScope'],
  ['staff_scopes_set', 'duty_scopes_set'],
  ['staff_scopes_removed', 'duty_scopes_removed'],
  ['staff_roles', 'admin_duties'],
  ['staff-roles', 'duties'],
  ['staff.role.grant', 'duty.grant'],
  ['staff.role.revoke', 'duty.revoke'],
  ['staff_grant', 'duty_grant'],
  ['staff_revoke', 'duty_revoke'],
  ['seenStaff', 'seenDuty'],
  // The shared inbox that admin alerts fall back to.
  ['staffAlertEmail', 'teamInboxEmail'],
  ['alertStaffIfUnattended', 'alertTeamIfUnattended'],
  ['notifyStaffOfRegistration', 'notifyTeamOfRegistration'],
  ['StaffAlertOptions', 'TeamAlertOptions'],
  ['alertStaff', 'alertTeam'],
]

/** A token with "staff" joined to other word characters, or a known hyphenated path. */
const COMPOUND = /\b(?:CANARY:staff-[a-z-]+|check-in-staff|staff-roles|[A-Za-z0-9_]*(?:[A-Za-z0-9_]staff|staff[A-Za-z0-9_]|[A-Za-z0-9_]Staff|Staff[A-Za-z0-9_]|[A-Za-z0-9_]STAFF|STAFF[A-Za-z0-9_])[A-Za-z0-9_]*)\b|staff\.role\.(?:grant|revoke)/g

export function renameToken(token) {
  // A migration file name (044_staff_roles, 20261110120000_event_staff_check_ins) is history.
  if (/^\d{3,}_/.test(token)) return token
  for (const [from, to] of SPECIFIC) {
    if (token.includes(from)) token = token.split(from).join(to)
  }
  return token.replace(/STAFF/g, 'CREW').replace(/Staff/g, 'Crew').replace(/staff/g, 'crew')
}

/** Files whose bare staff/Staff identifiers name the Staff role, or the member_role value. */
const KEEP_BARE = new Set(['lib/member-roles.ts', 'components/admin/access/PeopleTab.tsx', 'lib/member-roles.test.ts'])

/** Files whose bare `staff` holds admin_duties rows, so it becomes `duties`. */
const BARE_TO_DUTIES = new Set(['lib/tenancy/role-mapping.ts', 'lib/tenancy/role-mapping.test.ts', 'lib/authz/role-sync.ts', 'lib/authz/role-sync.test.ts'])

function renameBareIdentifiers(file, text) {
  if (KEEP_BARE.has(file) || !/\.(m?[jt]sx?)$/.test(file)) return { text, n: 0 }
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const edits = []
  const base = BARE_TO_DUTIES.has(file) ? 'duties' : 'crew'
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const map = { staff: base, Staff: base[0].toUpperCase() + base.slice(1), STAFF: base.toUpperCase() }
      if (Object.hasOwn(map, node.text)) edits.push([node.getStart(sf), node.getEnd(), map[node.text]])
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  edits.sort((a, b) => b[0] - a[0])
  for (const [s, e, r] of edits) text = text.slice(0, s) + r + text.slice(e)
  return { text, n: edits.length }
}

function files() {
  const scope = ['app', 'lib', 'components', 'packages', 'scripts', 'test', 'e2e', 'proxy.ts', 'proxy.test.ts', '.semgrep', 'ops/backups/critical-tables.txt',
    'docs/AUTHZ.md', 'docs/SECURITY-route-manifest.md', 'docs/TENANCY-S3.md', 'docs/TENANCY-S5.md', 'docs/TENANCY-S5-data.md', 'docs/TENANCY-S5-registration.md',
    'docs/S5-DECISION-REGISTER.md', 'docs/S5-CRONS-LIMITS-SMMA.md', 'docs/THREAT-MODEL.md', 'docs/RUNBOOK-event-check-in.md', 'docs/compliance']
  return execFileSync('git', ['ls-files', '--', ...scope], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && !f.startsWith('scripts/codemods/rename-staff') && !f.startsWith('scripts/lint-staff-word') && /\.(m?[jt]sx?|json|ya?ml|md|txt|sql)$/.test(f))
}

function main() {
  for (const [from, to] of MOVES) {
    if (!existsSync(from)) continue
    console.log(`move ${from} → ${to}`)
    if (WRITE) execFileSync('git', ['mv', from, to])
  }
  let compound = 0
  let bare = 0
  let changed = 0
  for (const file of files()) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (!/staff/i.test(text)) continue
    let c = 0
    let next = text.replace(COMPOUND, (m) => {
      const r = renameToken(m)
      if (r !== m) c++
      return r
    })
    const b = renameBareIdentifiers(file, next)
    next = b.text
    compound += c
    bare += b.n
    if (next !== text) {
      changed++
      if (WRITE) writeFileSync(file, next)
    }
  }
  console.log(`${WRITE ? 'wrote' : 'would change'} ${changed} files: ${compound} compound tokens, ${bare} bare identifiers`)
}

main()
