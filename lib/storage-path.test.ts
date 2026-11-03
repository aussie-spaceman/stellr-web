import { describe, it, expect } from 'vitest'
import { isLiteralStoragePath } from './storage-path'

// The object storage-js actually asks for: it appends the path to the bucket's
// URL unencoded, so the URL parser decides. The server decodes what remains.
const requested = (path: string) => {
  const base = 'https://project.supabase.co/storage/v1/object/community-resources/'
  const { pathname } = new URL(base + path)
  return decodeURIComponent(pathname.slice(new URL(base).pathname.length))
}

const PREFIX = 'resources/members/11111111-2222-3333-4444-555555555555/'

describe('isLiteralStoragePath', () => {
  // Each of these passes a string check against PREFIX, but storage reads,
  // writes or signs a different object — another member's, or an alias of the
  // same one under a second path string.
  it.each([
    [`${PREFIX}%2e%2e/99999999-8888-7777-6666-555555555555/1-x.pdf`, 'climbs out of the folder'],
    [`${PREFIX}.%2e/99999999-8888-7777-6666-555555555555/1-x.pdf`, 'climbs out of the folder'],
    [`${PREFIX}%2E%2E/%2E%2E/1-x.pdf`, 'climbs out of the folder'],
    [`${PREFIX}.\t./99999999-8888-7777-6666-555555555555/1-x.pdf`, 'climbs out of the folder'],
    [`${PREFIX}.\n./99999999-8888-7777-6666-555555555555/1-x.pdf`, 'climbs out of the folder'],
    [`${PREFIX}./1-x.pdf`, 'aliases another path'],
    [`${PREFIX}%2e/1-x.pdf`, 'aliases another path'],
    [`${PREFIX}1-x.pdf?v=2`, 'aliases another path'],
    [`${PREFIX}1-x.pdf#v2`, 'aliases another path'],
    [`${PREFIX}1-x.pdf `, 'aliases another path'],
  ])('refuses %j, which %s', (path) => {
    expect(path.startsWith(PREFIX)).toBe(true)
    expect(path.includes('..')).toBe(false)
    expect(requested(path)).not.toBe(path)
    expect(isLiteralStoragePath(path)).toBe(false)
  })

  it('still refuses traversal, separators and empty segments', () => {
    for (const path of ['', '../x.pdf', 'a/../b.pdf', '/a/b.pdf', 'a//b.pdf', 'a\\b.pdf', 'a/b/', 'a/b%2fc.pdf']) {
      expect(isLiteralStoragePath(path), JSON.stringify(path)).toBe(false)
    }
  })

  it('accepts every shape of path the app issues, each of which storage reads as written', () => {
    for (const path of [
      `${PREFIX}1730000000000-Proposal_v1.2.pdf`,
      'community-resources/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/members/11111111-2222-3333-4444-555555555555/1-notes.pdf',
      'event-email/nevada-sdc-2026/1730000000000-Schedule.PDF',
      'event-artwork/colorado/certificate-anita_gale-1730000000000-art.png',
      'training/cert-templates/m1-1730000000000.pdf',
      'community-media-staging/11111111-2222-3333-4444-555555555555/1-photo.jpeg',
      'educator-commons/campaign-starter-pack.pdf',
      '.hidden/x.pdf',
      'a b/c d.pdf',
    ]) {
      expect(isLiteralStoragePath(path), path).toBe(true)
      expect(requested(path)).toBe(path)
    }
  })
})
