/**
 * lint-staff-word.mjs: keep the word "staff" for the Staff role alone.
 *
 * WHY (13 Nov 2026): "staff" used to mean four different things in this repo
 * (the duty scopes table, a tenant_role value, a member_role classification,
 * and "admin or event manager" in general), and none of them was the Staff
 * role. They were renamed to Duties and crew, so that "staff" now means only
 * the role between Event Manager and Admin. This gate stops the old meanings
 * creeping back in.
 *
 * It parses TS/TSX/JS with the TypeScript compiler and checks identifiers,
 * string and template literals, and JSX text. Comments are skipped on
 * purpose: prose may still say "staff" in its plain sense.
 *
 * A file where the word is meant goes on STAFF_ROLE_FILES with its reason;
 * tests are skipped (their prose is free, their values are typed). A single
 * line can opt out with a trailing comment `staff-word-ok: <reason>`, reason
 * required. Legacy audit action names that are already in the hash chain live
 * on that comment, not in the allowlist.
 *
 *   npm run lint:staff-word            # all tracked code
 *   node scripts/lint-staff-word.mjs --list   # every hit, for inventory
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/** Where code lives. Migrations and docs are history and prose. */
const PATHSPECS = ['app', 'lib', 'components', 'packages', 'scripts', 'test', 'e2e', 'proxy.ts', 'proxy.test.ts']

const EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/

/**
 * Files where "staff" is meant, each with its reason. New Staff-role files join
 * the first group; nothing else should need to.
 */
export const STAFF_ROLE_FILES = {
  // The gate and the one-off rename name the word on purpose.
  'scripts/lint-staff-word.mjs': 'this gate',
  'scripts/codemods/rename-staff.mjs': 'the 13 Nov rename, kept as the record of it',
  // The Staff role itself (13 Nov 2026).
  'lib/authz/capabilities.ts': 'implements the Staff role',
  'lib/authz/decide.ts': 'implements the Staff role (portal role, event access, hidden pages)',
  'lib/authz/principal.ts': "tenant_role 'staff' is the Staff role",
  'lib/authz/role-sync.ts': 'keeps the Staff membership in step with the Clerk role',
  'lib/tenancy/role-mapping.ts': 'maps the Clerk staff role to its membership',
  'proxy.ts': 'gates Staff in the admin portal',
  // member_role_type 'staff' is kept: it mirrors the Staff role.
  'lib/member-roles.ts': "member_role_type 'staff' mirrors the Staff role",
  'components/admin/access/PeopleTab.tsx': "member_role_type 'staff' mirrors the Staff role",
  'components/admin/community/spaces/SpaceConfig.tsx': "space visibility for member_role 'staff'",
  // Legal text: wording changes go through counsel, not a rename.
  'app/(stellr)/(public)/privacy/page.tsx': 'legal text (Privacy Policy)',
  'app/(stellr)/(public)/terms/page.tsx': 'legal text (Terms)',
  'lib/school-data-terms.ts': 'legal text (School Data Terms)',
  // Public and member copy where "Stellr staff" means Stellr's people, which is what the Staff role is.
  'app/(stellr)/(public)/competitions/page.tsx': "plain English: Stellr's people",
  'app/(stellr)/(public)/impact/page.tsx': "plain English: Stellr's people",
  'app/(stellr)/(public)/membership/tier-data.ts': 'plain English: a school staff member',
  'app/(stellr)/(flow)/check-in/[slug]/code/page.tsx': "plain English: Stellr's people at the desk",
  'app/(stellr)/(member)/community/surveys/page.tsx': "plain English: Stellr's people",
  'components/team-profile/TeamProfileForm.tsx': "plain English: Stellr's people",
  'packages/web-ui/src/PathwayCard.stories.tsx': "plain English: Stellr's people",
  'app/api/admin/events/[slug]/pd-credentials/route.ts': 'credential wording issued to educators',
  'app/api/admin/agreements/[id]/email-changes/[changeId]/route.ts': 'signer-facing wording: "Stellr staff"',
}

/** Tests describe behaviour in prose; the values they assert are typed against the code. */
const SKIP = /(\.test\.[cm]?[jt]sx?$|\.spec\.[jt]s$|^test\/|^e2e\/)/

/** Matches "staff" inside any identifier or text, any case. */
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
    if (value !== null && WORD.test(value)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
      if (!OPT_OUT.test(lines[line] ?? '')) hits.push({ line: line + 1, what, value: value.trim().slice(0, 80) })
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
      console.log(`${file}:${h.line}  ${h.what}  ${JSON.stringify(h.value)}`)
    }
  }
  if (list) return
  if (total > 0) {
    console.error(`\nlint:staff-word: ${total} use(s) of "staff" outside the Staff role.`)
    console.error('Use "Duties" for the old staff_roles scopes and "crew" for admin/staff/event manager/volunteer/mentor.')
    console.error('A deliberate exception takes a trailing `staff-word-ok: <reason>` comment on the same line.')
    process.exit(1)
  }
  console.log('lint:staff-word: clean')
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main()
