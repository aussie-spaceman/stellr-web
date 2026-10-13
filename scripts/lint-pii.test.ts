import { describe, expect, it } from 'vitest'
import { ALLOWED_EMAIL_DOMAINS, inScope, isAllowedEmail, parseAddedLines, scanLine } from './lint-pii.mjs'

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

describe('parseAddedLines', () => {
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

  it('returns added lines with new-file line numbers, skipping deletions', () => {
    expect(parseAddedLines(diff)).toEqual([
      { file: 'docs/a.md', line: 3, text: 'new line' },
      { file: 'docs/a.md', line: 11, text: '++ an added line that looks like a header' },
      { file: 'docs/a.md', line: 12, text: 'second' },
      { file: 'docs/new file.md', line: 1, text: 'only line' },
    ])
  })

  it('returns nothing for an empty diff', () => {
    expect(parseAddedLines('')).toEqual([])
  })
})
