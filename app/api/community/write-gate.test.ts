// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Decision 24 (3 Nov 2026): a minor waiting on guardian consent, and a child
// under 13, are restricted in the community by ONE helper, communityWriteBlock
// (lib/community). The first version wired it into eight routes and left the
// rest open: coaching requests and bookings, cohort invites, mentoring
// sign-up, hosting tools, a teacher's nudge. This reads the source tree, so a
// new write handler under app/api/community that forgets the check fails CI
// instead of quietly opening another way round the restriction.
//
// Every exported POST, PUT, PATCH or DELETE must call communityWriteBlock, or
// be named in EXEMPT with the reason it is safe for a restricted member.

const ROOT = 'app/api/community'
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const

/**
 * Deliberate exceptions: handlers a restricted member may still use, because
 * they only touch the member's own private state, or because closing them
 * would stop a child reporting something that worried them.
 */
const EXEMPT: Record<string, string> = {
  'chat/delete/route.ts#POST': 'deletes the member’s own chat message; removing your own words is always allowed',
  'chat/flag/route.ts#POST': 'reports a chat message to moderators; safeguarding: anyone may report',
  'flag/route.ts#POST': 'reports a post or comment to moderators; safeguarding: anyone may report',
  'training/[itemId]/flag/route.ts#POST': 'tells staff a lesson resource is broken; seen by staff only',
  'notifications/route.ts#POST': 'marks the member’s own notifications read',
  'training/progress/route.ts#POST': 'records the member’s own lesson progress; no other member sees it',
  'sessions/actions/route.ts#POST': 'ticks an action item assigned to the member; private to them and their host',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name === 'route.ts') out.push(p)
  }
  return out
}

/** Source with comments blanked, so a comment naming the helper does not count. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** From `start` to the closing brace at column 0. */
const bodyFrom = (src: string, start: number) => {
  const end = src.indexOf('\n}', start)
  return src.slice(start, end === -1 ? undefined : end)
}

/**
 * An audited handler (docs/TENANCY-S5.md, B16) is exported as a one-line call of the
 * file's own audited() helper, handing it the function that does the work:
 * `return audited(req, spec, () => doThing(req))`. The body that counts is doThing's,
 * a top-level function of the same file. One that cannot be found reads as empty, so
 * the check below fails rather than passing on the wrapper.
 */
const DELEGATE = /^\s*return audited\(req, \{[^}]*\}, \(\) => ([A-Za-z_$][\w$]*)\([^)]*\)\)\s*$/

function delegateBody(src: string, wrapper: string): string | null {
  const lines = wrapper.split('\n').slice(1).filter((l) => l.trim())
  if (lines.length !== 1) return null
  const m = lines[0].match(DELEGATE)
  if (!m) return null
  const at = src.search(new RegExp(`^async function ${m[1]}\\(`, 'm'))
  return at === -1 ? '' : bodyFrom(src, at)
}

/** Each exported write handler's body: from its `export` to the closing brace at column 0. */
function writeHandlers(src: string): Array<{ method: string; body: string; delegated: boolean }> {
  const found: Array<{ method: string; body: string; delegated: boolean }> = []
  const re = new RegExp(`^export\\s+(?:async\\s+function|const)\\s+(${WRITE_METHODS.join('|')})\\b`, 'gm')
  for (const m of src.matchAll(re)) {
    const body = bodyFrom(src, m.index ?? 0)
    const delegated = delegateBody(src, body)
    found.push({ method: m[1], body: delegated ?? body, delegated: delegated !== null })
  }
  return found
}

const files = walk(ROOT)
const handlers = files.flatMap((f) => {
  const src = code(readFileSync(f, 'utf8'))
  return writeHandlers(src).map((h) => ({ key: `${relative(ROOT, f)}#${h.method}`, ...h }))
})

describe('every community write handler applies the age and consent restrictions', () => {
  it('finds the write handlers (the scan is reading the tree)', () => {
    expect(handlers.length).toBeGreaterThan(25)
  })

  it('reads an audited handler through to the function doing the work', () => {
    expect(handlers.filter((h) => h.delegated).length).toBeGreaterThan(25)
    const src = [
      'export async function POST(req: Request) {',
      "  return audited(req, { action: 'x.y.z' }, () => doThing(req))",
      '}',
      '',
      'async function doThing(req: Request) {',
      "  const blocked = await communityWriteBlock(m, 'post')",
      '}',
    ].join('\n')
    const [h] = writeHandlers(src)
    expect(h.delegated).toBe(true)
    expect(h.body).toContain('communityWriteBlock(')
    // A delegate that is not in the file reads as empty: no check found.
    const [missing] = writeHandlers(src.replace('async function doThing', 'async function other'))
    expect(missing.body).toBe('')
    // Anything more than the one-line wrapper is read as it stands.
    const [extra] = writeHandlers(src.replace('  return audited', '  await supabaseServer()\n  return audited'))
    expect(extra.delegated).toBe(false)
  })

  it('is spelled in no other way: `export { x as POST }` would hide a handler from this scan', () => {
    for (const f of files) {
      expect(code(readFileSync(f, 'utf8')), f).not.toMatch(/as\s+(POST|PUT|PATCH|DELETE)\b/)
    }
  })

  for (const h of handlers) {
    if (EXEMPT[h.key]) continue
    it(`${h.key} calls communityWriteBlock before touching the database`, () => {
      const gate = h.body.indexOf('communityWriteBlock(')
      expect(gate, `${h.key} has no communityWriteBlock call: add one, or name it in EXEMPT with the reason`).toBeGreaterThan(-1)
      const db = h.body.indexOf('supabaseServer(')
      if (db !== -1) expect(gate, `${h.key} reaches the database before the check`).toBeLessThan(db)
    })
  }

  it('every exemption names a real handler that does not already check (no stale entries)', () => {
    for (const key of Object.keys(EXEMPT)) {
      const h = handlers.find((x) => x.key === key)
      expect(h, `${key} is exempt but no longer exists`).toBeTruthy()
      expect(h!.body.includes('communityWriteBlock('), `${key} now checks: drop it from EXEMPT`).toBe(false)
    }
  })
})
