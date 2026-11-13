// @vitest-environment node
//
// lib/survey/hold.ts is the one place that decides whether another tenant's survey is held
// (W7-16, and the owner's 13 Nov 2026 decision to hide its links too). Lifting the hold is
// that predicate alone, so nothing else may decide it, and every place that builds a
// participant-facing survey link either asks it or is listed here with the reason it does not.
// A new place that builds a survey link fails this test until it is added to SITES.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')
const DIRS = ['app', 'lib', 'components']

function sources(dir: string): string[] {
  const abs = path.join(ROOT, dir)
  return readdirSync(abs).flatMap((name) => {
    const rel = path.join(dir, name)
    if (statSync(path.join(ROOT, rel)).isDirectory()) return name === 'node_modules' ? [] : sources(rel)
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec|stories)\.tsx?$/.test(name) ? [rel] : []
  })
}

const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8')
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const ALL = DIRS.flatMap(sources).map((f) => f.split(path.sep).join('/'))

/** What builds a survey link a participant follows: a token link, the event page, the merge field, the gate's link. */
const BUILDS_LINK = /surveyLink\(|surveyUrlFor\(|\/survey\/event\/\$\{|feedback_link:/

const ASKS = 'asks the hold'
const SITES: Record<string, string> = {
  'lib/survey/send.ts': ASKS,
  'lib/check-in-view.ts': ASKS,
  // The value is built here; lib/event-emails/send.ts eventVarsFor asks the hold and empties it.
  'lib/event-emails/render.ts': 'held in lib/event-emails/send.ts',
  'lib/survey/tokens.ts': 'defines surveyLink',
  'components/admin/competitions/EventSurveyPanel.tsx': 'staff only: the admin Survey tab’s QR code',
  'components/survey/SurveyLinkRequest.tsx': 'the survey page’s own request to the link route, which asks the hold',
  // Outside the 13 Nov 2026 slice: the per-event certificate survey gate, off unless an admin
  // turns it on. Open item, reported with that slice.
  'lib/survey/certificate-gate.ts': 'certificate gate: open item',
  'app/api/credentials/[number]/certificate/route.ts': 'certificate gate: open item',
}

const importsHold = (src: string) => /import \{[^}]*\bsurveySendsHeld\b[^}]*\} from '(@\/lib\/survey\/hold|\.\/hold)'/.test(src)

describe('lib/survey/hold.ts is the single source of the survey hold', () => {
  it('only hold.ts defines surveySendsHeld', () => {
    const defining = ALL.filter((f) => /\b(function|const|let)\s+surveySendsHeld\b/.test(code(read(f))))
    expect(defining).toEqual(['lib/survey/hold.ts'])
  })

  it('every file that builds a survey link is listed, and each one marked as asking it imports and calls it', () => {
    const building = ALL.filter((f) => BUILDS_LINK.test(code(read(f)))).sort()
    expect(building).toEqual(Object.keys(SITES).sort())
    for (const [file, how] of Object.entries(SITES)) {
      if (how !== ASKS) continue
      const src = code(read(file))
      expect(importsHold(src), file).toBe(true)
      expect(src, file).toMatch(/\bsurveySendsHeld\(/)
    }
  })

  it('the check-in page asks it before it reads an invitation or works out the survey status', () => {
    const src = code(read('lib/check-in-view.ts'))
    const body = src.slice(src.indexOf('async function surveyStateFor'))
    const guard = body.indexOf('if (surveySendsHeld(distributionTenant(d))) return null')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(body.indexOf('statusNow('))
    expect(guard).toBeLessThan(body.indexOf(".from('survey_invitations')"))
  })

  it('{{feedback_link}} is emptied in one place, behind the hold, and the renderer leaves its line out', () => {
    const emptying = ALL.filter((f) => /feedback_link\s*=\s*''/.test(code(read(f))))
    expect(emptying).toEqual(['lib/event-emails/send.ts'])
    const send = code(read('lib/event-emails/send.ts'))
    expect(importsHold(send)).toBe(true)
    expect(send).toMatch(/if \(surveySendsHeld\(email\.tenant_id \?\? STELLR_TENANT_ID\)\) vars\.feedback_link = ''/)
    expect(code(read('lib/event-emails/render.ts'))).toMatch(/OMIT_WHEN_EMPTY = \['feedback_link'\]/)
  })

  it('nothing outside hold.ts compares a survey distribution’s tenant with Stellr’s', () => {
    const comparing = ALL.filter((f) => f !== 'lib/survey/hold.ts' && /distributionTenant\([^)]*\)\s*[!=]==/.test(code(read(f))))
    expect(comparing).toEqual([])
  })
})
