import { describe, expect, it } from 'vitest'
import { ALLOWED_EMAIL_DOMAINS, inScope, isAllowedEmail, newLines, parseDiff, scanLine } from './lint-pii.mjs'

// Every value here is invented. Flagged addresses use example.net or reserved
// TLDs (.test, .invalid), which no real person can hold.

const kinds = (line: string) => scanLine(line).map((f) => f.kind)

describe('scanLine: email addresses', () => {
  it('flags an address on a domain that is not allowlisted', () => {
    expect(kinds('Reply to guardian@family.test about the form')).toEqual(['email'])
    expect(kinds('cc someone@example.net')).toEqual(['email'])
  })

  it.each(ALLOWED_EMAIL_DOMAINS)('allows any address @%s', (domain) => {
    expect(kinds(`write to team@${domain}`)).toEqual([])
  })

  it('allows the bot co-author address but not its domain', () => {
    expect(kinds('Co-Authored-By: Claude <noreply@anthropic.com>')).toEqual([])
    expect(kinds('ask support@anthropic.com')).toEqual(['email'])
  })

  it('matches the allowlist case-insensitively', () => {
    expect(kinds('Ops@StellrEducation.ORG')).toEqual([])
    expect(isAllowedEmail('NoReply@Anthropic.com')).toBe(true)
  })

  it('matches domains exactly, not as suffixes', () => {
    expect(isAllowedEmail('a.seed@example.com')).toBe(true)
    expect(isAllowedEmail('a@sub.example.com')).toBe(false)
    expect(isAllowedEmail('a@notexample.com')).toBe(false)
  })

  it('leaves package specifiers and version pins alone', () => {
    expect(kinds('import { Button } from "@stellr/web-ui"; react@18.3.1')).toEqual([])
  })

  it('catches a URL-encoded @ (%40) in a search link, against the same allowlist', () => {
    expect(kinds('https://mail.example.org/#search/from%3Aguardian%40family.test')).toEqual(['email'])
    expect(kinds('?q=team%40stellreducation.org')).toEqual([])
  })

  it('stays linear on a long line with no @', () => {
    const start = performance.now()
    expect(kinds('a'.repeat(200_000))).toEqual([])
    // Quadratic matching took ~40 s at 160k characters; linear is milliseconds.
    expect(performance.now() - start).toBeLessThan(2000)
  })
})

describe('scanLine: credential numbers', () => {
  it('flags an 8-character real-format number, in any case', () => {
    expect(kinds('see /credentials/STL-2026-AB12CD34')).toEqual(['credential'])
    expect(kinds('stl-2031-ab12cd34')).toEqual(['credential'])
  })

  it('allows the e2e fixtures and the format placeholder', () => {
    expect(kinds('STL-2026-E2EGRACE and STL-2026-E2EADA01')).toEqual([])
    expect(kinds('numbers look like STL-2026-XXXXXXXX')).toEqual([])
  })

  it('ignores other lengths', () => {
    expect(kinds('STL-2026-AB12CD3 and STL-2026-AB12CD345')).toEqual([])
  })
})

describe('scanLine: Gmail draft and message IDs', () => {
  it('flags r- and r followed by 15+ digits', () => {
    expect(kinds('draft r-123456789012345')).toEqual(['gmail-id'])
    expect(kinds('draft r9876543210987654321')).toEqual(['gmail-id'])
  })

  it('ignores 14 digits, an r inside a word, and migration timestamps', () => {
    expect(kinds('r-12345678901234')).toEqual([])
    expect(kinds('order1234567890123456')).toEqual([])
    expect(kinds('20260928180000_cron_runs.sql')).toEqual([])
  })
})

describe('scanLine: Clerk user IDs', () => {
  it('flags user_ followed by 20+ alphanumerics', () => {
    expect(kinds('clerk id user_2AbCdEfGhIjKlMnOpQrStUv')).toEqual(['clerk-id'])
  })

  it('ignores column names and short suffixes', () => {
    // 19 characters after user_.
    expect(kinds('members.clerk_user_id, user_id, user_abcdefghij012345678')).toEqual([])
  })
})

describe('scanLine: the pii-ok escape', () => {
  it('skips a line with a reasoned escape', () => {
    expect(kinds('DMARC reports go to rua@reports.test <!-- pii-ok: vendor role mailbox -->')).toEqual([])
  })

  it('does not skip on an escape without a reason', () => {
    expect(kinds('rua@reports.test <!-- pii-ok: -->')).toEqual(['email'])
    expect(kinds('rua@reports.test <!-- pii-ok:-->')).toEqual(['email'])
  })

  it('reports each finding with its column', () => {
    expect(scanLine('a@x.test then user_aaaaaaaaaaaaaaaaaaaa')).toEqual([
      { kind: 'email', column: 1, value: 'a@x.test' },
      { kind: 'clerk-id', column: 15, value: 'user_aaaaaaaaaaaaaaaaaaaa' },
    ])
  })
})

describe('inScope', () => {
  it.each(['docs/handovers/x.md', '.claude/skills/ship/SKILL.md', 'README.md', 'CLAUDE.md'])('covers %s', (p) => {
    expect(inScope(p)).toBe(true)
  })

  it.each(['app/README.md', 'lib/credentials.ts', 'content/post.md', 'scripts/lint-pii.mjs'])('skips %s', (p) => {
    expect(inScope(p)).toBe(false)
  })
})

describe('parseDiff', () => {
  const diff = [
    'diff --git a/docs/a.md b/docs/a.md',
    'index 1111111..2222222 100644',
    '--- a/docs/a.md',
    '+++ b/docs/a.md',
    '@@ -3 +3 @@ heading',
    '-old line',
    '+new line',
    '@@ -10,0 +11,2 @@',
    '+++ an added line that looks like a header',
    '+second',
    'diff --git a/docs/gone.md b/docs/gone.md',
    'deleted file mode 100644',
    '--- a/docs/gone.md',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-was here',
    '-and here',
    'diff --git a/docs/new file.md b/docs/new file.md',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/docs/new file.md\t',
    '@@ -0,0 +1 @@',
    '+only line',
    '\\ No newline at end of file',
  ].join('\n')

  it('returns added lines with new-file line numbers, and removed lines', () => {
    expect(parseDiff(diff)).toEqual({
      added: [
        { file: 'docs/a.md', line: 3, text: 'new line' },
        { file: 'docs/a.md', line: 11, text: '++ an added line that looks like a header' },
        { file: 'docs/a.md', line: 12, text: 'second' },
        { file: 'docs/new file.md', line: 1, text: 'only line' },
      ],
      removed: ['old line', 'was here', 'and here'],
    })
  })

  it('returns nothing for an empty diff', () => {
    expect(parseDiff('')).toEqual({ added: [], removed: [] })
  })

  it('counts a blank context line printed as empty (diff.suppressBlankEmpty)', () => {
    const merged = ['+++ b/docs/a.md', '@@ -1,3 +1,3 @@', '-one', '+uno', '', '-three', '+tres', '+++ b/docs/b.md', '@@ -0,0 +1 @@', '+next'].join('\n')
    expect(parseDiff(merged).added).toEqual([
      { file: 'docs/a.md', line: 1, text: 'uno' },
      { file: 'docs/a.md', line: 3, text: 'tres' },
      { file: 'docs/b.md', line: 1, text: 'next' },
    ])
  })

  it('strips CR, so a CRLF → LF conversion re-adds identical text', () => {
    const crlf = ['+++ b/docs/a.md', '@@ -1 +1 @@', '-same text\r', '+same text'].join('\n')
    const { added, removed } = parseDiff(crlf)
    expect(newLines(added, removed)).toEqual([])
  })
})

describe('newLines', () => {
  const at = (file: string, line: number, text: string) => ({ file, line, text })

  it('drops an added line the diff also removed: a row moved into another file', () => {
    const added = [at('docs/archive/rows.md', 1, '| row | contact guardian@family.test |'), at('docs/archive/rows.md', 2, 'a genuinely new line')]
    expect(newLines(added, ['| row | contact guardian@family.test |'])).toEqual([added[1]])
  })

  it('excuses each removed line once, so a duplicated line still counts', () => {
    const line = 'reply to guardian@family.test'
    const added = [at('docs/a.md', 1, line), at('docs/b.md', 1, line)]
    expect(newLines(added, [line])).toEqual([added[1]])
  })
})
