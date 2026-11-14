/**
 * lint-staff-word.mjs: keep "staff" for the Staff role, by refusing its retired meanings.
 *
 * WHY (13 Nov 2026): "staff" used to mean four things in this repo (the duty
 * scopes table, a tenant_role value, a member_role classification, and "admin
 * or event manager" in general), and none was the Staff role. They were renamed
 * to Duties and crew, and "staff" now means the role between Event Manager and
 * Admin. A gate on the word itself would refuse the role's own code, so this
 * refuses the RETIRED NAMES instead: anything that brings an old meaning back.
 *
 * It parses TS/TSX/JS with the TypeScript compiler and checks identifiers,
 * string and template literals, regexes and JSX text. Comments are skipped:
 * prose may say "staff" in its plain sense. Tests are skipped too.
 *
 * A line that must keep a retired name (reading what a device stored before
 * the rename, say) opts out with a trailing comment `staff-word-ok: <reason>`,
 * reason required.
 *
 *   npm run lint:staff-word                  # all tracked code
 *   node scripts/lint-staff-word.mjs --list  # every hit, tests included
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/** Where code lives. Migrations and docs are history and prose. */
const PATHSPECS = ['app', 'lib', 'components', 'packages', 'scripts', 'test', 'e2e', 'proxy.ts', 'proxy.test.ts']

const EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/

/** Files that name the retired words on purpose. */
export const STAFF_ROLE_FILES = {
  'scripts/lint-staff-word.mjs': 'this gate',
  'scripts/codemods/rename-staff.mjs': 'the 13 Nov rename, kept as the record of it',
}

/**
 * The retired names, and what replaced each. Matched as whole tokens inside an
 * identifier or text (so isStaffTargetOrUnknown and 'public.staff_roles' are
 * caught), case-sensitive.
 */
export const RETIRED = [
  ['staff_roles', 'admin_duties (Duties)'],
  ['STAFF_SCOPES', 'DUTY_SCOPES'],
  ['StaffScope', 'DutyScope'],
  ['StaffRolesManager', 'DutiesManager'],
  ['staff-roles', '/api/admin/duties'],
  ['staffAudience', 'dutyAudience'],
  ['requireEventStaff', 'requireEventCrew'],
  ['requireTenantStaff', 'requireTenantCrew'],
  ['decideTenantStaff', 'decideTenantCrew'],
  ['tenant_staff', 'tenant_crew'],
  ['TENANT_STAFF', 'TENANT_CREW'],
  ['isStaffTarget', 'isCrewTarget'],
  ['decideStaffTarget', 'decideCrewTarget'],
  ['isStaffRole', 'isCrewRole'],
  ['STAFF_CLERK_ROLES', 'CREW_CLERK_ROLES'],
  ['StaffPersona', 'CrewPersona'],
  ['staffAlertEmail', 'teamInboxEmail'],
  ['alertStaff', 'alertTeam'],
  ['notifyStaffOfRegistration', 'notifyTeamOfRegistration'],
  ['event_staff_check_ins', 'event_crew_check_ins'],
  ['staff_key', 'crew_key'],
  ['staffKey', 'crewKey'],
  ['staff_check_in', 'crew_check_in'],
  ['staff_undo', 'crew_undo'],
  ['check-in-staff', 'check-in-crew'],
  ['DeskStaff', 'DeskCrew'],
  ['Staff roles', 'Duties'],
  ['staff inbox', 'team inbox'],
  ['/admin/staff', '/admin/duties'],
]

const RETIRED_RE = new RegExp(RETIRED.map(([w]) => w.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')).join('|'))

/** Tests describe behaviour in prose; the values they assert are typed against the code. */
const SKIP = /(\.test\.[cm]?[jt]sx?$|\.spec\.[jt]s$|^test\/|^e2e\/)/

/** A file worth parsing: it mentions staff at all. */
const WORD = /staff/i

const OPT_OUT = /staff-word-ok:\s*\S/

/** The hits in one file's source, skipping comments. */
export function findStaffWords(fileName, text) {
  const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : fileName.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind)
  const lines = text.split('\n')
  const hits = []
  const visit = (node) => {
    let value = null
    let what = null
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      value = node.text
      what = 'identifier'
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      value = node.text
      what = 'string'
    } else if (ts.isJsxText(node)) {
      value = node.text
      what = 'jsx-text'
    } else if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      value = node.getText(sf)
      what = 'regex'
    }
    const hit = value !== null ? RETIRED_RE.exec(value) : null
    // '/admin/staff' is retired only as the whole path: /admin/staffing is not it.
    if (hit && !(hit[0] === '/admin/staff' && /^[a-z-]/.test(value.slice(hit.index + hit[0].length)))) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
      if (!OPT_OUT.test(lines[line] ?? '')) hits.push({ line: line + 1, what, value: value.trim().slice(0, 80), retired: hit[0] })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '--', ...PATHSPECS], { encoding: 'utf8' })
  return out.split('\n').filter((f) => EXTENSIONS.test(f) && !f.endsWith('.d.ts'))
}

function main() {
  const list = process.argv.includes('--list')
  let total = 0
  for (const file of trackedFiles()) {
    if (!list && (Object.hasOwn(STAFF_ROLE_FILES, file) || SKIP.test(file))) continue
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (!WORD.test(text)) continue
    for (const h of findStaffWords(file, text)) {
      total++
      const now = RETIRED.find(([w]) => w === h.retired)?.[1]
      console.log(`${file}:${h.line}  ${h.what}  ${JSON.stringify(h.value)}  (retired: ${h.retired}; use ${now})`)
    }
  }
  if (list) return
  if (total > 0) {
    console.error(`\nlint:staff-word: ${total} use(s) of a retired "staff" name.`)
    console.error('"staff" now means the Staff role. Use Duties for the old staff_roles scopes and crew for admin/staff/event manager/volunteer/mentor.')
    console.error('A deliberate exception takes a trailing `staff-word-ok: <reason>` comment on the same line.')
    process.exit(1)
  }
  console.log('lint:staff-word: clean')
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main()
