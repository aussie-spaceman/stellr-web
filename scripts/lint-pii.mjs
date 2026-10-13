/**
 * lint-pii.mjs — reject personal data in ADDED lines of docs/, .claude/ and
 * root *.md.
 *
 * Runs in CI's `verify` job, which every PR runs, docs-only ones included. It
 * is NOT in `prebuild`: Vercel builds from a shallow clone with no `origin/dev`
 * to diff against.
 *
 * WHY (13 Oct 2026): aussie-spaceman/stellr-web is public. An audit of docs/
 * and .claude/ found 365 references to real people outside staff, across 45
 * files, more than half of them minors and their families: names, personal
 * emails, credential numbers, Gmail draft IDs. The rule ("People: the repo is
 * public" in .claude/skills/close-out/SKILL.md) came with a pre-push grep that
 * only runs when someone remembers. This is that grep's mechanical half, made
 * a gate. It cannot see names, so reading the diff for them stays manual.
 *
 * Only ADDED lines are checked, against the merge base with origin/dev. The
 * existing files hold known historical data, and whether to redact them is a
 * separate decision; this stops new data arriving while that is open.
 *
 *   npm run lint:pii                    # branch + working tree vs origin/dev
 *   npm run lint:pii -- --base origin/main
 *   git log origin/dev..HEAD --format=%B | npm run lint:pii -- --stdin
 *
 * A deliberate exception (a vendor's role mailbox, say) takes a trailing
 * `<!-- pii-ok: <reason> -->` on the same line. The reason is required.
 *
 * Findings name the file, line and kind but never the value: CI logs on a
 * public repo are public too.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The diff base when --base is not given. */
export const DEFAULT_BASE = 'origin/dev'

/** git pathspecs for the scope. `:(glob)*.md` is root-only: glob `*` stops at `/`. */
const PATHSPECS = ['docs', '.claude', ':(glob)*.md']

/** Domains whose addresses are staff, fixtures or bots, never a member. */
export const ALLOWED_EMAIL_DOMAINS = [
  'stellreducation.org',
  'mail.stellreducation.org',
  'example.com',
  'example.org',
  'users.noreply.github.com',
]

/** Whole addresses allowed on a domain that is otherwise not. */
export const ALLOWED_EMAIL_ADDRESSES = ['noreply@anthropic.com']

/** What each kind is called in the report. */
export const KIND_LABELS = {
  email: 'email address (domain not on the allowlist)',
  credential: 'credential number (shows the holder\'s name once public)',
  'gmail-id': 'Gmail draft/message ID',
  'clerk-id': 'Clerk user ID',
}

// Each pattern refuses a letter or digit immediately before it, so `r-…` inside
// a longer word is not a Gmail ID. Underscore is allowed before, so a value in
// a snake_case key still counts.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// 8 Crockford chars (lib/credentials.ts). STL-20NN-E2E… are the e2e fixtures,
// and STL-20NN-XXXXXXXX is the placeholder the docs write for the format.
const CREDENTIAL = /(?<![A-Za-z0-9])STL-20\d{2}-(?!E2E)(?!X{8})[A-Z0-9]{8}(?![A-Za-z0-9])/gi
const GMAIL_ID = /(?<![A-Za-z0-9])r-?\d{15,}/g
const CLERK_ID = /(?<![A-Za-z0-9])user_[A-Za-z0-9]{20,}/g

const ESCAPE = /<!--\s*pii-ok:(.*?)-->/

/** True for a path the lint covers: docs/**, .claude/**, or a root *.md. */
export function inScope(path) {
  return path.startsWith('docs/') || path.startsWith('.claude/') || /^[^/]+\.md$/.test(path)
}

/** True when an address is on the allowlist. Case-insensitive; domains match exactly. */
export function isAllowedEmail(address) {
  const lower = address.toLowerCase()
  if (ALLOWED_EMAIL_ADDRESSES.includes(lower)) return true
  return ALLOWED_EMAIL_DOMAINS.includes(lower.slice(lower.lastIndexOf('@') + 1))
}

/**
 * The personal data on one line, or [] when there is none or the line carries
 * a `<!-- pii-ok: <reason> -->` escape with a non-empty reason.
 *
 * @param {string} line
 * @returns {{ kind: keyof typeof KIND_LABELS, column: number, value: string }[]}
 */
export function scanLine(line) {
  const escape = line.match(ESCAPE)
  if (escape && escape[1].trim()) return []

  const found = []
  const add = (kind, m) => found.push({ kind, column: m.index + 1, value: m[0] })
  for (const m of line.matchAll(EMAIL)) if (!isAllowedEmail(m[0])) add('email', m)
  for (const m of line.matchAll(CREDENTIAL)) add('credential', m)
  for (const m of line.matchAll(GMAIL_ID)) add('gmail-id', m)
  for (const m of line.matchAll(CLERK_ID)) add('clerk-id', m)
  return found.sort((a, b) => a.column - b.column)
}

/** A `+++ b/path` header's path, or null for `/dev/null`. */
function headerPath(raw) {
  // git appends a tab to the name when it contains a space, and quotes it when
  // it holds a quote, backslash or control character.
  let name = raw.replace(/\t$/, '')
  if (name.startsWith('"')) {
    try { name = JSON.parse(name) } catch { name = name.slice(1, -1) }
  }
  if (name === '/dev/null') return null
  return name.replace(/^b\//, '')
}

/**
 * The added lines in a unified diff, with their new-file line numbers.
 *
 * Walks hunks by their header counts rather than by prefix, so an added line
 * whose own text starts with `++` is not mistaken for a file header.
 *
 * @param {string} diff  output of `git diff -U0`
 * @returns {{ file: string, line: number, text: string }[]}
 */
export function parseAddedLines(diff) {
  const added = []
  let file = null
  let oldLeft = 0
  let newLeft = 0
  let lineNo = 0

  for (const raw of diff.split('\n')) {
    const text = raw.replace(/\r$/, '')
    if (oldLeft > 0 || newLeft > 0) {
      if (text.startsWith('+')) {
        if (file) added.push({ file, line: lineNo, text: text.slice(1) })
        lineNo++
        newLeft--
      } else if (text.startsWith('-')) {
        oldLeft--
      } else if (text.startsWith(' ')) {
        lineNo++
        oldLeft--
        newLeft--
      }
      // `\ No newline at end of file` counts toward neither side.
      continue
    }

    if (text.startsWith('+++ ')) {
      file = headerPath(text.slice(4))
      continue
    }
    const hunk = text.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1])
      lineNo = Number(hunk[2])
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3])
    }
  }
  return added
}

function git(args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function fail(message) {
  console.error(`\n✗ PII lint: ${message}\n`)
  process.exit(2)
}

/** Added lines on this branch and in the working tree, plus untracked files, all in scope. */
function collectFromGit(base) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`])
  } catch {
    fail(`cannot resolve ${base}. Run \`git fetch origin dev\`, or pass --base <ref>.`)
  }
  let mergeBase
  try {
    mergeBase = git(['merge-base', base, 'HEAD']).trim()
  } catch {
    fail(`no merge base between ${base} and HEAD. A shallow clone needs fetch-depth: 0.`)
  }

  // Against the working tree, not HEAD, so uncommitted edits are checked too
  // (in CI the two are the same). -M keeps a moved file to its changed lines:
  // moving a historical file is not adding its contents.
  const diff = git(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-U0', '-M', mergeBase, '--', ...PATHSPECS])
  const lines = parseAddedLines(diff).filter((l) => inScope(l.file))

  // A new file nobody has `git add`ed yet is not in the diff, but it is what
  // the next commit publishes.
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...PATHSPECS])
    .split('\0')
    .filter((f) => f && inScope(f))
  for (const file of untracked) {
    const buf = readFileSync(file)
    if (buf.includes(0)) continue // binary
    buf.toString('utf8').split('\n').forEach((text, i) => lines.push({ file, line: i + 1, text: text.replace(/\r$/, '') }))
  }

  return { lines, label: `added lines vs ${base} (merge base ${mergeBase.slice(0, 8)})` }
}

function main(argv) {
  const stdin = argv.includes('--stdin')
  const baseAt = argv.indexOf('--base')
  const base = baseAt === -1 ? DEFAULT_BASE : argv[baseAt + 1]
  if (!base) fail('--base needs a ref')

  const { lines, label } = stdin
    ? {
        lines: readFileSync(0, 'utf8').split('\n').map((text, i) => ({ file: 'stdin', line: i + 1, text })),
        label: 'stdin',
      }
    : collectFromGit(base)

  const findings = []
  for (const { file, line, text } of lines) {
    for (const f of scanLine(text)) findings.push({ file, line, ...f })
  }

  if (findings.length) {
    console.error(`\n✗ PII lint: ${findings.length} finding(s) in ${label}\n`)
    for (const f of findings) console.error(`  ${f.file}:${f.line}:${f.column}  ${KIND_LABELS[f.kind]}`)
    console.error(
      '\n  The repo is public. Refer to people by role and members.id, never by\n' +
        '  name, personal email, credential number or mailbox ID. See "People: the\n' +
        '  repo is public" in .claude/skills/close-out/SKILL.md.\n\n' +
        '  Values are not printed, because this log is public too.\n\n' +
        '  A deliberate exception takes a trailing comment on the same line:\n' +
        '      <!-- pii-ok: <reason> -->\n',
    )
    process.exit(1)
  }

  const files = new Set(lines.map((l) => l.file)).size
  console.log(`✓ PII lint: nothing found in ${lines.length} line(s), ${files} file(s), ${label}`)
}

// Run only as a script, not when the unit test imports the functions above.
function invokedDirectly() {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (invokedDirectly()) main(process.argv.slice(2))
