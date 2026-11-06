import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Every page under app/, as a URL to request. Walked from the tree, not listed, so
 * a new page joins check (a) by existing. A dynamic segment gets a value no record
 * has, because the harness has no records: such a page answers as it does for an
 * unknown id, on both servers.
 */

const FIXTURE_ID = '00000000-0000-4000-8000-00000000b10a'

function segmentToPath(segment: string): string | null {
  if (segment.startsWith('(') && segment.endsWith(')')) return null
  if (segment.startsWith('[[...')) return null
  const dynamic = /^\[(?:\.\.\.)?(.+)\]$/.exec(segment)
  if (dynamic) return /id$/i.test(dynamic[1]) ? FIXTURE_ID : `harness-${dynamic[1]}`
  return decodeURIComponent(segment)
}

/** `app/(flow)/survey/[token]/page.tsx` to `/survey/harness-token`. */
export function pagePathForFile(file: string): string {
  const parts = file.split(/[/\\]/).slice(1, -1)
  const path = parts.map(segmentToPath).filter((part) => part !== null)
  return `/${path.join('/')}`
}

export function pageFiles(appDir = 'app'): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === 'page.tsx') files.push(relative('.', full).split(sep).join('/'))
    }
  }
  walk(appDir)
  return files.sort()
}

/**
 * The scoped sample beside the pages: metadata routes, and GET APIs of each kind.
 * A signed-out request reaches the guard on the guarded ones, which is the point.
 */
export const SAMPLED_PATHS = [
  '/robots.txt',
  '/sitemap.xml',
  '/api/schools/lookup',
  '/api/members/me',
  '/api/admin/health/integrations',
  '/api/cron/entitlements',
  '/images/logo-horiz.png',
]
