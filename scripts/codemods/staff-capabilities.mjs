/**
 * staff-capabilities.mjs: the Staff role, phase 3 (13 Nov 2026). A one-off.
 *
 * Moves each admin route handler from an admin-only guard to the capability
 * its owner decision names (lib/authz/capabilities.ts), method by method. A GET
 * becomes portal:read (Staff reads the whole portal); a write becomes the
 * capability of its area, or stays admin-only when it is not in MAP. Only the
 * guard call inside the handler changes:
 *
 *   isAdminClaims(sessionClaims)        → (await hasCapability('<cap>', { route }))
 *   await isStellrAdmin({ route })      → await hasCapability('<cap>', { route })
 *   await currentUserIsAdmin()          → await hasCapability('<cap>')
 *
 * A call outside a handler (a shared helper) is reported, not changed.
 *
 *   node scripts/codemods/staff-capabilities.mjs           # dry run
 *   node scripts/codemods/staff-capabilities.mjs --write
 */
import { readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'

const WRITE = process.argv.includes('--write')
const R = 'portal:read'

/** route (under app/api/admin) → method → capability. A method not listed keeps its admin-only guard. */
export const MAP = {
  // Read only for Staff: every GET, no write.
  'coaching': { GET: R },
  'community/flags': { GET: R },
  'community/resources': { GET: R },
  'community/resources/search': { GET: R },
  'community/spaces': { GET: R },
  'community/spaces/[id]/members': { GET: R },
  'community/spaces/sources/search': { GET: R },
  'community/training/modules': { GET: R },
  'community/training/recording': { GET: R },
  'community/training/resources': { GET: R },
  'containers/[id]/contents': { GET: R },
  'email/campaigns': { GET: R },
  'email/templates': { GET: R },
  'entitlements/discounts': { GET: R },
  'esign/state': { GET: R },
  'esign/templates/[id]/preview': { GET: R },
  'membership/rules': { GET: R },
  'training/cert-preview': { GET: R },
  'training/live-room': { GET: R },
  'training/tracking': { GET: R },
  'members/[id]/access': { GET: R },
  'members/[id]/activity': { GET: R },
  'members/[id]/spaces': { GET: R },
  'members/search': { GET: R },
  // Competitions.
  'artwork-defaults/[theme]/badge-templates': { GET: R, PUT: 'competitions:write', DELETE: 'competitions:write' },
  'artwork-defaults/[theme]/badge-templates/preview': { GET: R },
  'artwork-defaults/[theme]/certificate-templates': { GET: R, PUT: 'competitions:write', DELETE: 'competitions:write' },
  'artwork-defaults/[theme]/certificate-templates/preview': { GET: R },
  'pd-certificate': { GET: R, PUT: 'competitions:write', DELETE: 'competitions:write' },
  'pd-certificate/preview': { GET: R },
  'event-managers': { GET: R, POST: 'event_managers:assign', DELETE: 'event_managers:assign' },
  // Members. members/[id] DELETE stays admin-only (members:delete).
  'members': { POST: 'members:write' },
  'members/[id]': { PATCH: 'members:write' },
  'members/[id]/invite': { POST: 'members:write' },
  'members/[id]/memberships': { POST: 'members:write' },
  'members/[id]/memberships/[membershipId]': { PATCH: 'members:write', DELETE: 'members:write' },
  'members/[id]/event-participations': { POST: 'members:write' },
  'members/[id]/volunteer-agreement': { POST: 'members:write' },
  'members/[id]/background-check': { POST: 'members:write' },
  'members/[id]/volunteer': { POST: 'volunteers:write', DELETE: 'volunteers:write' },
  'schools/[id]': { PATCH: 'schools:write' },
  // Data out: Staff exports as an admin does (owner decision), every export logged.
  'members/[id]/background-check/report': { GET: 'export' },
}

const OLD = new Set(['isAdminClaims', 'isStellrAdmin', 'currentUserIsAdmin'])

function handlers(sf) {
  const out = []
  for (const st of sf.statements) {
    const exported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!exported) continue
    if (ts.isFunctionDeclaration(st) && st.name && /^(GET|POST|PUT|PATCH|DELETE)$/.test(st.name.text)) out.push({ method: st.name.text, node: st })
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && /^(GET|POST|PUT|PATCH|DELETE)$/.test(d.name.text) && d.initializer) out.push({ method: d.name.text, node: d.initializer })
      }
    }
  }
  return out
}

function convert(file, caps) {
  let text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const edits = []
  const inside = []
  for (const h of handlers(sf)) {
    const cap = caps[h.method]
    if (!cap) continue
    inside.push([h.node.getStart(sf), h.node.getEnd()])
    const visit = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && OLD.has(n.expression.text)) {
        const name = n.expression.text
        const args = n.arguments.map((a) => a.getText(sf))
        let rep
        if (name === 'isAdminClaims') rep = `(await hasCapability('${cap}'))`
        else if (name === 'isStellrAdmin') rep = `hasCapability('${cap}'${args.length ? `, ${args.join(', ')}` : ''})`
        else rep = `hasCapability('${cap}')`
        edits.push([n.getStart(sf), n.getEnd(), rep])
      }
      ts.forEachChild(n, visit)
    }
    visit(h.node)
  }
  // Calls outside any converted handler: a shared helper, or a method left admin-only.
  const outside = []
  const all = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && OLD.has(n.expression.text)) {
      const p = n.getStart(sf)
      if (!inside.some(([s, e]) => p >= s && p < e)) outside.push(sf.getLineAndCharacterOfPosition(p).line + 1)
    }
    ts.forEachChild(n, all)
  }
  all(sf)
  edits.sort((a, b) => b[0] - a[0])
  for (const [s, e, r] of edits) text = text.slice(0, s) + r + text.slice(e)
  if (edits.length) {
    // Import hasCapability from lib/authz, merging into an existing import.
    const m = text.match(/import \{([^}]*)\} from '@\/lib\/authz'\n/)
    if (m) { if (!/\bhasCapability\b/.test(m[1])) text = text.replace(m[0], `import {${m[1].replace(/\s*$/, '')}, hasCapability } from '@/lib/authz'\n`.replace('{ ,', '{ ')) }
    else text = text.replace(/(import [^\n]*\n)(?!import)/, `$1import { hasCapability } from '@/lib/authz'\n`)
    // Drop imports and sessionClaims bindings nothing uses any more.
    for (const name of ['isAdminClaims', 'currentUserIsAdmin', 'isStellrAdmin']) {
      const uses = (text.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length
      if (uses === 1) text = text.replace(new RegExp(`(import \\{[^}]*?)\\s*\\b${name}\\b,?([^}]*\\})`), (_, a, b) => `${a}${b}`).replace(/import \{\s*,?\s*\} from '[^']+'\n/, '')
    }
  }
  return { text, n: edits.length, outside }
}

let total = 0
for (const [route, caps] of Object.entries(MAP)) {
  const file = `app/api/admin/${route}/route.ts`
  const { text, n, outside } = convert(file, caps)
  total += n
  console.log(`${n ? 'converted' : 'NOTHING  '} ${route} (${n})${outside.length ? `  still admin-only at lines ${outside.join(', ')}` : ''}`)
  if (WRITE && n) writeFileSync(file, text)
}
console.log(`${WRITE ? 'wrote' : 'would write'} ${total} guard(s)`)
