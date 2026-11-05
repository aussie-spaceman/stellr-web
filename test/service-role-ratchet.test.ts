// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  classifyServiceRole,
  collectSources,
  isProvisionalClass,
  isTestFile,
  measure,
  nextServiceRoleFiles,
  nextServiceRoleSeed,
  readBaseline,
  serviceRoleDiff,
  serviceRoleEntryProblems,
  serviceRoleFacts,
  summarize,
} from '../scripts/s5-inventory.mjs'

// S5 data access (C2): the service-role client bypasses RLS, so the set of files
// that reach it may only shrink. A new caller must be added to the baseline with
// a class and a reason, through scripts/s5-inventory.mjs --write --allow-grow.
// A file that stops using it must leave the baseline (--write), so the ratchet
// tightens instead of leaving room for a later caller.
//
// A CLASS IS NOT A CONVERSION EXEMPTION WHILE ITS REASON STARTS "auto:". The
// seeded classes are a heuristic over direct `.from()` calls and miss tables
// reached through helpers in other modules. A later slice must not skip a file
// because it is stellr_only, identity, platform or system until a person has
// confirmed the class by replacing the reason (isProvisionalClass). What IS
// enforced here: a non-convert file may not touch a tenant or event-scoped table
// directly, and an "auto:" reason is only accepted on the frozen seed list.

const HOW = 'npx tsx scripts/s5-inventory.mjs --write (add --allow-grow for a new file, then give it a real reason)'
const NEW_CALLER = "import { supabaseServer } from '@/lib/supabase'\nexport async function POST() { await supabaseServer().from('credentials').select('id') }\n"
/** The size of the seed list when it was frozen. It never grows: lower this as reasons are replaced. */
const SEED_LIST_MAX = 418

describe('service-role ratchet', () => {
  let live: ReturnType<typeof measure>
  const baseline = readBaseline(process.cwd(), 'serviceRole')
  const seedList: string[] = readBaseline(process.cwd(), 'serviceRoleSeed')?.files ?? []

  beforeAll(() => {
    live = measure(collectSources(process.cwd()))
  }, 120_000)

  it('has a committed baseline', () => {
    expect(baseline).not.toBeNull()
  })

  it('no new file calls the service-role client', () => {
    const { added } = serviceRoleDiff(baseline, live.serviceRole)
    expect(added, `New service-role callers. Prefer tenantDb or a helper; otherwise: ${HOW}`).toEqual([])
  })

  it('the baseline lists no file that stopped calling it', () => {
    const { stale } = serviceRoleDiff(baseline, live.serviceRole)
    expect(stale, `These no longer use the service role, so shrink the ratchet: ${HOW}`).toEqual([])
  })

  it('every entry has a valid class and a real reason, and its class fits its live tables', () => {
    expect(serviceRoleDiff(baseline, live.serviceRole, seedList).invalid).toEqual([])
  })

  it('the seed list is exactly the "auto:" entries, and it never grows', () => {
    const auto = Object.entries(baseline?.files ?? {})
      .filter(([, e]) => isProvisionalClass(e))
      .map(([f]) => f)
      .sort()
    expect([...seedList].sort()).toEqual(auto)
    expect(seedList.length).toBeLessThanOrEqual(SEED_LIST_MAX)
  })

  it('the baseline count equals the inventory count', () => {
    expect(Object.keys(baseline?.files ?? {}).length).toBe(summarize(live).serviceRoleFiles)
  })

  it('a synthetic new supabaseServer caller fails the ratchet', () => {
    const file = 'app/api/zz-synthetic/route.ts'
    const measured = { ...live.serviceRole, ...measure(new Map([[file, NEW_CALLER]])).serviceRole }
    expect(serviceRoleDiff(baseline, measured).added).toEqual([file])
  })

  it('a removed caller shows as stale, so the ratchet must shrink', () => {
    const [first, ...rest] = Object.keys(live.serviceRole)
    const measured = Object.fromEntries(rest.map((f) => [f, live.serviceRole[f]]))
    expect(serviceRoleDiff(baseline, measured).stale).toEqual([first])
  })
})

describe('serviceRoleFacts', () => {
  it('counts a call, not a mention', () => {
    expect(serviceRoleFacts('lib/a.ts', '// supabaseServer() is the service role\nexport const a = 1\n')).toBeNull()
    expect(serviceRoleFacts('lib/a.ts', "const s = 'supabaseServer()'\n")).toBeNull()
    expect(serviceRoleFacts('lib/supabase.ts', 'export function supabaseServer() { return 1 }\n')).toBeNull()
  })

  it('counts both clients, including a dynamic import', () => {
    expect(serviceRoleFacts('lib/a.ts', 'supabaseServerTyped()')).not.toBeNull()
    const dyn = "async function f() { const { supabaseServer } = await import('@/lib/supabase'); return supabaseServer() }"
    expect(serviceRoleFacts('app/api/x/route.ts', dyn)).not.toBeNull()
  })

  it('an alias or a passed reference is still a use', () => {
    expect(serviceRoleFacts('lib/a.ts', "import { supabaseServer as db } from '@/lib/supabase'\ndb()\n")).not.toBeNull()
    expect(serviceRoleFacts('lib/a.ts', "import { supabaseServer } from '@/lib/supabase'\nrun(supabaseServer)\n")).not.toBeNull()
    expect(serviceRoleFacts('app/api/x/route.ts', "async function f() { const { supabaseServerTyped: db } = await import('@/lib/supabase'); return db() }")).not.toBeNull()
  })

  it('does not count a same-named import from another module, or a type', () => {
    expect(serviceRoleFacts('lib/a.ts', "import { supabaseServer } from './fake'\nexport const a = supabaseServer\n")).toBeNull()
    expect(serviceRoleFacts('lib/a.ts', "import type { supabaseServer } from '@/lib/supabase'\nexport type A = typeof supabaseServer\n")).toBeNull()
  })

  it('counts a client built directly with the secret key', () => {
    const viaHelper = "import { createClient } from '@supabase/supabase-js'\nimport { supabaseSecretKey } from '@/lib/supabase-keys'\nconst db = createClient(url, supabaseSecretKey() ?? '')\ndb.from('members').select()\n"
    expect(serviceRoleFacts('app/api/x/route.ts', viaHelper)?.tables).toEqual(['public.members'])
    expect(serviceRoleFacts('app/api/x/route.ts', "import { createClient } from '@supabase/supabase-js'\ncreateClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)\n")).not.toBeNull()
    expect(serviceRoleFacts('app/api/x/route.ts', "import { createClient } from '@supabase/supabase-js'\ncreateClient(url, process.env.SUPABASE_SECRET_KEY!)\n")).not.toBeNull()
  })

  it('does not count a public client, or a mention in a comment', () => {
    expect(serviceRoleFacts('lib/a.ts', "import { createClient } from '@supabase/supabase-js'\ncreateClient(url, supabasePublicKey())\n")).toBeNull()
    expect(serviceRoleFacts('lib/a.ts', "// createClient with SUPABASE_SECRET_KEY is banned\ncreateClient(url, key)\n")).toBeNull()
    expect(serviceRoleFacts('lib/a.ts', "export const names = ['SUPABASE_SECRET_KEY']\n")).toBeNull()
  })

  it('counts a re-export, which would hide every importer behind it', () => {
    expect(serviceRoleFacts('lib/a.ts', "export { supabaseServer as db } from '@/lib/supabase'\n")).not.toBeNull()
    expect(serviceRoleFacts('lib/a.ts', "export { supabaseSecretKey } from './supabase-keys'\n")).not.toBeNull()
    expect(serviceRoleFacts('lib/a.ts', "// supabaseServer\nexport * from '@/lib/supabase'\n")).not.toBeNull()
    expect(serviceRoleFacts('lib/a.ts', "// supabaseServer\nexport { supabaseBrowser } from '@/lib/supabase'\n")).toBeNull()
  })

  it('counts any property read of a client function, called or not', () => {
    expect(serviceRoleFacts('lib/a.ts', "import * as s from '@/lib/supabase'\nconst db = s.supabaseServer\ndb()\n")).not.toBeNull()
    expect(serviceRoleFacts('lib/a.ts', "async function f() { const m = await import('@/lib/supabase'); const d = m.supabaseServer; return d() }")).not.toBeNull()
    expect(serviceRoleFacts('lib/a.ts', "async function f() { const m = await import('@/lib/supabase'); return m['supabaseServerTyped'] }")).not.toBeNull()
  })

  it('counts any read of the secret key, whichever client it builds', () => {
    const forms = [
      "import { supabaseSecretKey as k } from '@/lib/supabase-keys'\nimport { createClient } from '@supabase/supabase-js'\ncreateClient(u, k())\n",
      "import { createClient as mk } from '@supabase/supabase-js'\nmk(u, process.env.SUPABASE_SECRET_KEY)\n",
      "import { createServerClient } from '@supabase/ssr'\ncreateServerClient(u, process.env.SUPABASE_SERVICE_ROLE_KEY, {})\n",
      "import { SupabaseClient } from '@supabase/supabase-js'\nnew SupabaseClient(u, process.env['SUPABASE_SECRET_KEY'])\n",
      "fetch(u + '/rest/v1/members', { headers: { apikey: process.env.SUPABASE_SECRET_KEY } })\n",
      "const { SUPABASE_SECRET_KEY } = process.env\nexport const k = SUPABASE_SECRET_KEY\n",
      "import { supabaseSecretKey } from '@/lib/supabase-keys'\nexport const ok = !!supabaseSecretKey()\n",
      "const name = 'SUPABASE_SECRET_KEY'\ncreateClient(u, process.env[name])\n",
    ]
    for (const src of forms) expect(serviceRoleFacts('lib/a.ts', src), src).not.toBeNull()
  })

  it('exempts the modules that define the clients and read the key', () => {
    expect(serviceRoleFacts('lib/supabase.ts', 'export function a() { return supabaseServer() }\n')).toBeNull()
    expect(serviceRoleFacts('lib/supabase-keys.ts', 'export const k = () => process.env.SUPABASE_SECRET_KEY\n')).toBeNull()
  })

  it('flags tables the file does not name', () => {
    const unnamed = (src: string) => serviceRoleFacts('lib/a.ts', `import { supabaseServer } from '@/lib/supabase'\n${src}`)?.reachesUnnamedTables
    expect(unnamed("supabaseServer().from('members').select()")).toBe(false)
    expect(unnamed('supabaseServer().from(table).select()')).toBe(true)
    expect(unnamed('supabaseServer().rpc(name)')).toBe(true)
    expect(unnamed('helper(supabaseServer())')).toBe(true)
    expect(unnamed('const db = supabaseServer()\nawait helper(db, 1)')).toBe(true)
    expect(unnamed('const db = supabaseServer()\nawait helper({ db })')).toBe(true)
    expect(unnamed('run(supabaseServer)')).toBe(true)
  })

  it('does not take other .from() calls or a storage bucket for a table', () => {
    const unnamed = (src: string) => serviceRoleFacts('lib/a.ts', `import { supabaseServer } from '@/lib/supabase'\nconst db = supabaseServer()\n${src}`)?.reachesUnnamedTables
    expect(unnamed('Array.from(xs); Buffer.from(y)')).toBe(false)
    expect(unnamed('db.storage.from(bucket).list()')).toBe(false)
    expect(unnamed("db.from('members').eq('a', id); list.map((x) => db.from('members').eq('b', x))")).toBe(false)
  })

  it('lists registry tables, and skips storage buckets', () => {
    const src = "const s = supabaseServer()\ns.from('members').select()\ns.from('credentials').select()\ns.storage.from('artwork').list()\ns.from('not_a_table').select()\n"
    expect(serviceRoleFacts('lib/a.ts', src)?.tables).toEqual(['?not_a_table', 'public.credentials', 'public.members'])
  })
})

describe('classifyServiceRole', () => {
  it('classes by path, then by the registry class of the tables', () => {
    expect(classifyServiceRole('scripts/x.ts', ['public.credentials']).class).toBe('script')
    expect(classifyServiceRole('lib/x.ts', ['public.credentials', 'public.members']).class).toBe('convert')
    expect(classifyServiceRole('lib/x.ts', ['public.community_posts', 'public.members']).class).toBe('stellr_only')
    expect(classifyServiceRole('lib/x.ts', ['public.members']).class).toBe('identity')
    expect(classifyServiceRole('lib/x.ts', ['public.schools']).class).toBe('platform')
    expect(classifyServiceRole('lib/x.ts', ['public.cron_runs']).class).toBe('system')
    expect(classifyServiceRole('lib/x.ts', []).class).toBe('convert')
  })

  it('a file that reaches tables it does not name is always convert', () => {
    expect(classifyServiceRole('lib/x.ts', ['public.members'], true).class).toBe('convert')
    expect(classifyServiceRole('lib/x.ts', ['public.cron_runs'], true).class).toBe('convert')
    expect(classifyServiceRole('scripts/x.ts', ['public.members'], true).class).toBe('script')
  })

  it('classes the review examples as convert: a helper that gets the client, and dynamic tables', () => {
    const merchCommit = "import { supabaseServer } from '@/lib/supabase'\nimport { commit } from '@/lib/store/event-batch'\nexport async function POST() { const db = supabaseServer(); await db.from('members').select(); await commit(db) }\n"
    const facts = serviceRoleFacts('app/api/admin/events/[slug]/merch/commit/route.ts', merchCommit)
    expect(classifyServiceRole('app/api/admin/events/[slug]/merch/commit/route.ts', facts?.tables ?? [], facts?.reachesUnnamedTables).class).toBe('convert')
  })

  it('marks every generated reason provisional, and a person\'s reason not', () => {
    expect(isProvisionalClass(classifyServiceRole('lib/x.ts', ['public.members']))).toBe(true)
    expect(isProvisionalClass({ class: 'identity', reason: 'Reads only the caller\'s own member row, confirmed by review.' })).toBe(false)
  })
})

describe('class against live tables', () => {
  const human = { class: 'identity', reason: 'a person wrote this reason' }
  const auto = { class: 'identity', reason: 'auto: no tenant or event-scoped table, classed by its identity tables' }

  it('a non-convert file may not touch a tenant or event-scoped table, whoever classed it', () => {
    const measured = { 'lib/a.ts': { tables: ['public.credentials', 'public.participants'], reachesUnnamedTables: false } }
    const problems = serviceRoleDiff({ files: { 'lib/a.ts': human } }, measured).invalid
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('public.credentials')
    expect(serviceRoleDiff({ files: { 'lib/a.ts': { ...human, class: 'convert' } } }, measured).invalid).toEqual([])
    expect(serviceRoleDiff({ files: { 'scripts/a.ts': { ...human, class: 'script' } } }, { 'scripts/a.ts': measured['lib/a.ts'] }).invalid).toEqual([])
  })

  it('a provisional non-convert class fails once the file reaches unnamed tables; a person may keep it', () => {
    const measured = { 'lib/a.ts': { tables: ['public.members'], reachesUnnamedTables: true } }
    expect(serviceRoleDiff({ files: { 'lib/a.ts': auto } }, measured, ['lib/a.ts']).invalid).toHaveLength(1)
    expect(serviceRoleDiff({ files: { 'lib/a.ts': human } }, measured).invalid).toEqual([])
  })
})

describe('baseline writer', () => {
  const baseline = { files: { 'lib/a.ts': { class: 'identity', reason: 'a human wrote this reason' }, 'lib/gone.ts': { class: 'system', reason: 'no longer calls it' } } }
  const measured = { 'lib/a.ts': { tables: [] }, 'lib/new.ts': { tables: ['public.members'] } }

  it('shrinks, keeps a human reason, and does not grow by default', () => {
    expect(nextServiceRoleFiles(baseline, measured)).toEqual({ 'lib/a.ts': baseline.files['lib/a.ts'] })
  })

  it('a grown entry carries a TODO reason, which the ratchet rejects until replaced', () => {
    const next = nextServiceRoleFiles(baseline, measured, { allowGrow: true }) as Record<string, { class: string; reason: string }>
    expect(next['lib/new.ts'].class).toBe('identity')
    expect(serviceRoleEntryProblems('lib/new.ts', next['lib/new.ts'])).toEqual(['lib/new.ts: replace the TODO reason with a real one'])
    expect(serviceRoleDiff({ files: next }, measured).invalid).toHaveLength(1)
  })

  it('rejects an unknown class or an empty reason', () => {
    expect(serviceRoleEntryProblems('f', { class: 'whatever', reason: 'long enough reason' })).toHaveLength(1)
    expect(serviceRoleEntryProblems('f', { class: 'system', reason: '' })).toHaveLength(1)
    expect(serviceRoleEntryProblems('f', null)).toHaveLength(1)
  })

  it('accepts an "auto:" reason only on the seed list', () => {
    const copied = { class: 'identity', reason: 'auto: anything at all, copied from a neighbour' }
    expect(serviceRoleEntryProblems('lib/new.ts', copied)).toHaveLength(1)
    expect(serviceRoleEntryProblems('lib/new.ts', copied, ['lib/old.ts'])).toHaveLength(1)
    expect(serviceRoleEntryProblems('lib/old.ts', copied, ['lib/old.ts'])).toEqual([])
    expect(serviceRoleEntryProblems('lib/new.ts', { ...copied, reason: '  AUTO : disguised, still generated' })).toHaveLength(1)
  })

  it('re-derives an "auto:" entry from live facts, and never a person\'s', () => {
    const auto = { class: 'identity', reason: 'auto: no tenant or event-scoped table, classed by its identity tables' }
    const facts = { 'lib/a.ts': { tables: ['public.members'], reachesUnnamedTables: true } }
    expect((nextServiceRoleFiles({ files: { 'lib/a.ts': auto } }, facts) as Record<string, { class: string }>)['lib/a.ts'].class).toBe('convert')
    const person = { class: 'identity', reason: 'a person confirmed this one' }
    expect((nextServiceRoleFiles({ files: { 'lib/a.ts': person } }, facts) as Record<string, unknown>)['lib/a.ts']).toEqual(person)
  })

  it('the seed list only shrinks: a replaced reason leaves it, and nothing joins it', () => {
    const files = {
      'lib/a.ts': { class: 'convert', reason: 'auto: still generated' },
      'lib/b.ts': { class: 'convert', reason: 'a person replaced this' },
      'lib/new.ts': { class: 'convert', reason: 'auto: not on the list' },
    }
    expect(nextServiceRoleSeed({ files: ['lib/a.ts', 'lib/b.ts', 'lib/gone.ts'] }, files)).toEqual(['lib/a.ts'])
  })
})

describe('isTestFile', () => {
  it('skips tests and the root test trees, not a route segment named test', () => {
    expect(isTestFile('lib/a.test.ts')).toBe(true)
    expect(isTestFile('lib/a.spec.tsx')).toBe(true)
    expect(isTestFile('lib/a.test.mjs')).toBe(true)
    expect(isTestFile('test/fake-supabase.ts')).toBe(true)
    expect(isTestFile('e2e/fixtures/x.ts')).toBe(true)
    expect(isTestFile('app/api/admin/email/campaigns/[id]/test/route.ts')).toBe(false)
  })

  it('does not exempt a file that only has .test. in the middle of its name', () => {
    expect(isTestFile('lib/a.test.helper.ts')).toBe(false)
    expect(isTestFile('lib/my.spec.config.js')).toBe(false)
  })
})

describe('collectSources', () => {
  it('walks every directory but the skip list, so a new top-level one is scanned', () => {
    const root = mkdtempSync(join(tmpdir(), 's5-inventory-'))
    const put = (rel: string) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      writeFileSync(join(root, rel), 'export const a = 1\n')
    }
    try {
      for (const f of ['brand-new/x.ts', 'lib/a.ts', 'proxy.ts', 'lib/a.test.ts', 'test/t.ts', 'node_modules/p/i.js', '.claude/worktrees/w/lib/a.ts', 'docs/archive/a.ts', 'public/a.js', 'lib/a.d.ts']) put(f)
      expect([...collectSources(root).keys()]).toEqual(['brand-new/x.ts', 'lib/a.ts', 'proxy.ts'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
