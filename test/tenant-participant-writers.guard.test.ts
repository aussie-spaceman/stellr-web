// @vitest-environment node
//
// Every code path that inserts a participant either issues the guardian's consent
// envelope or refuses minors on a tenant's event (S5 wave 6, A16; review id
// AMD-LATER-WRITERS, docs/TENANCY-S5.md "Any later tenant participant writer").
//
// Why: the consent trigger (zzz_participants_open_tenant_guardian_consent) opens a
// pending consent row for any participant under 18 on another organiser's event,
// whoever writes it. Only register/individual sends the guardian's envelope. A row
// opened any other way has no envelope: the participant is held from check-in and
// event mail, and with the flag off nothing ever removes it. So a new writer must do
// one of the two things below, and this test makes adding one a decision.
//
// How: it scans app/ and lib/ (tests excluded) for inserts and upserts into
// participants, through the Supabase client (`.from('participants')` then
// `.insert(`/`.upsert(` in the same chain) and in raw SQL, and compares what it
// finds with WRITERS, file by file and count by count. A writer it finds that
// WRITERS does not list fails, as does a listed one that is gone. Each listed
// writer names its evidence, which is checked:
//
//   envelope: the file calls openTenantGuardianConsent, and the gate that admits
//             its minors is the only caller that passes `guardianConsent: true`.
//   refuses:  the file where its dates of birth are checked calls assertRegistrable
//             and never passes `guardianConsent`, so a tenant-event minor gets
//             minorRefusal (lib/registration/eligibility.ts).
//
// Adding a writer: decide which it is, make it so, and add it here with the reason.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

type Evidence =
  | { kind: 'envelope'; file: string; gate: string }
  | { kind: 'refuses'; file: string }

interface Writer {
  /** Inserts or upserts into participants in this file. */
  sites: number
  reason: string
  evidence: Evidence
}

const WRITERS: Record<string, Writer> = {
  'lib/registration/individual/persist.ts': {
    sites: 1,
    reason:
      'POST /api/register/individual. A tenant-event minor is admitted only consent-pending (assertRegistrable with guardianConsent, behind the readiness guard), and the guardian is sent the consent envelope (openTenantGuardianConsent); if that fails the registration is taken back.',
    evidence: { kind: 'envelope', file: 'lib/registration/individual/persist.ts', gate: 'lib/registration/individual/gate.ts' },
  },
  'lib/registration/group/persist.ts': {
    sites: 1,
    reason: 'POST /api/register/group. The gate checks every date of birth first (checkDatesOfBirth), without guardianConsent, so a tenant-event minor is refused before any row is written.',
    evidence: { kind: 'refuses', file: 'lib/registration/group/roster.ts' },
  },
  'lib/registration/group-join/persist.ts': {
    sites: 1,
    reason: 'POST /api/register/group-join. The joiner\'s date of birth goes through assertRegistrable without guardianConsent (parse.ts), so a tenant-event minor is refused.',
    evidence: { kind: 'refuses', file: 'lib/registration/group-join/parse.ts' },
  },
  'lib/group-participant-add.ts': {
    sites: 2,
    reason:
      'An organiser or admin adding to a group roster (the organiser\'s team page and the admin event roster). assertRegistrable with the roster\'s context, without guardianConsent: nobody under 18 is added to a tenant\'s group.',
    evidence: { kind: 'refuses', file: 'lib/group-participant-add.ts' },
  },
  'lib/sheet-participant-sync.ts': {
    sites: 1,
    reason: 'The Google Sheet roster sync. Each row goes through assertRegistrable without guardianConsent, so a tenant-event minor is left out.',
    evidence: { kind: 'refuses', file: 'lib/sheet-participant-sync.ts' },
  },
}

const ROOTS = ['app', 'lib']
const SOURCE = /\.(ts|tsx|js|mjs)$/
const TEST = /\.(test|spec)\.|\/__tests__\//

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (SOURCE.test(name) && !TEST.test(path)) out.push(path)
  }
  return out
}

const FROM_PARTICIPANTS = /\.from\(\s*(['"`])participants\1\s*\)/g
const SQL_INSERT = /\binsert\s+into\s+(?:public\.)?"?participants"?\b/gi

/**
 * Inserts and upserts into participants in one source file. A client chain is read
 * from its `.from('participants')` up to the next query, statement or blank line,
 * so `.insert(` on the lines after it counts and a later query's does not.
 */
function participantWriteSites(src: string): number {
  let sites = 0
  for (const m of src.matchAll(FROM_PARTICIPANTS)) {
    const rest = src.slice(m.index + m[0].length)
    const stops = [rest.search(/\.from\(/), rest.search(/;\s*\n/), rest.search(/\n\s*\n/)].filter((i) => i >= 0)
    const chain = rest.slice(0, stops.length ? Math.min(...stops) : rest.length)
    if (/\.(insert|upsert)\(/.test(chain)) sites += 1
  }
  sites += [...src.matchAll(SQL_INSERT)].length
  return sites
}

function scan(): Record<string, number> {
  const found: Record<string, number> = {}
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const sites = participantWriteSites(readFileSync(file, 'utf8'))
      if (sites) found[relative('.', file).split('\\').join('/')] = sites
    }
  }
  return found
}

const read = (file: string) => readFileSync(file, 'utf8')

describe('tenant participant writers (AMD-LATER-WRITERS)', () => {
  it('the scanner finds a client insert or upsert across lines, and ignores reads and other tables', () => {
    expect(participantWriteSites("const { data } = await db\n  .from('participants')\n  .insert(row)\n  .select().single()\n")).toBe(1)
    expect(participantWriteSites('await db.from("participants").upsert(rows, { onConflict: "id" });\n')).toBe(1)
    expect(participantWriteSites("await db.from('participants').select('id').eq('id', x);\nawait db.from('members').insert(m)\n")).toBe(0)
    expect(participantWriteSites("await db.from('participants').update({ a: 1 }).eq('id', x)\n")).toBe(0)
    expect(participantWriteSites('await sql`INSERT INTO public.participants (id) VALUES (${id})`')).toBe(1)
  })

  it('every participant writer in app/ and lib/ is listed, with its count, and every listed one still exists', () => {
    const found = scan()
    const listed = Object.fromEntries(Object.entries(WRITERS).map(([file, w]) => [file, w.sites]))
    expect(
      found,
      'A participant writer appeared or changed. Make it issue the guardian envelope or refuse minors on a tenant event, then list it in WRITERS with the reason.',
    ).toEqual(listed)
  })

  it.each(Object.entries(WRITERS))('%s: its evidence holds', (_file, writer) => {
    expect(writer.reason.length).toBeGreaterThan(40)
    const src = read(writer.evidence.file)
    if (writer.evidence.kind === 'envelope') {
      expect(src).toMatch(/\bopenTenantGuardianConsent\(/)
      expect(read(writer.evidence.gate)).toMatch(/assertRegistrable\(.*\{\s*guardianConsent:\s*true\s*\}\)/)
    } else {
      expect(src).toMatch(/\bassertRegistrable\(/)
      expect(src, `${writer.evidence.file} must not offer guardian consent`).not.toMatch(/guardianConsent/)
    }
  })

  it('only the envelope writer’s gate passes guardianConsent, so no other path admits a minor consent-pending', () => {
    const offering = ROOTS.flatMap((root) => walk(root))
      .filter((file) => /guardianConsent:\s*true/.test(read(file)))
      .map((file) => relative('.', file).split('\\').join('/'))
    const gates = Object.values(WRITERS).flatMap((w) => (w.evidence.kind === 'envelope' ? [w.evidence.gate] : []))
    expect(offering.sort()).toEqual(gates.sort())
  })
})
