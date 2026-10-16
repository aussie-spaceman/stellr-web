/**
 * worktree-sweep.mjs — remove the sibling worktrees whose work has provably
 * landed, and say why every other one is still there.
 *
 *   npm run worktrees               # report only; changes nothing
 *   npm run worktrees -- --apply    # from the main checkout: remove the "remove" rows
 *
 * A linked worktree is removed only when all of these hold:
 *   - a branch is checked out in it, and it is not locked;
 *   - `git status --porcelain` there is empty (untracked files count, ignored
 *     ones such as node_modules, .next and .env.local do not);
 *   - a MERGED PR has the branch's exact tip as its head (`headRefOid`), so
 *     every commit on it is on GitHub and in the base branch;
 *   - no running process has its working directory inside it (a live session,
 *     or a `next dev` someone left running).
 * Then it runs `git worktree remove` (never --force) and `git branch -D`. `-D`
 * is right after a squash: a squashed branch is never an ancestor of `dev`.
 * The remote branch is GitHub's job (delete_branch_on_merge is on).
 *
 * Worktrees under .claude/worktrees/ belong to Claude app sessions. They are
 * listed and never touched: archive the session in the app instead.
 *
 * --apply refuses to run from a linked worktree. A worktree-isolated session
 * may not reach outside its worktree, and this must not become the way round
 * that. It reports, and the next ship, promote or close-out run from the main
 * checkout sweeps.
 *
 * WHY (16 Oct 2026): three days after #408/#410 moved every merge to the main
 * checkout so that `gh pr merge --delete-branch` would clean up, four more
 * worktrees sat beside the repo. Three were merged from the main checkout but
 * without `--delete-branch`. The fourth belonged to a worktree-isolated
 * session that could not reach the main checkout at all, and its close-out PR
 * was never merged. Cleanup that depends on one exact command, run from one
 * place, fails silently whenever a session does anything else. This checks
 * the outcome instead, and the skills run it at the start and at the end.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `git worktree list --porcelain` → [{ path, head, branch, detached, locked, prunable }]; the main worktree first. */
export function parsePorcelain(text) {
  const out = []
  for (const block of text.split(/\n\s*\n/)) {
    const wt = {}
    for (const line of block.split('\n')) {
      const [key, ...rest] = line.split(' ')
      const value = rest.join(' ')
      if (key === 'worktree') wt.path = value
      else if (key === 'HEAD') wt.head = value
      else if (key === 'branch') wt.branch = value.replace(/^refs\/heads\//, '')
      else if (key === 'detached') wt.detached = true
      else if (key === 'locked') wt.locked = value
      else if (key === 'prunable') wt.prunable = value || true
    }
    if (wt.path) out.push(wt)
  }
  return out
}

/** True when `path` is `dir` or anywhere below it. */
export function isInside(path, dir) {
  return path === dir || path.startsWith(dir.endsWith('/') ? dir : `${dir}/`)
}

/** `lsof -F pn` output → [{ pid, cwd }]. */
export function parseLsof(text) {
  const out = []
  let pid = null
  for (const line of text.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid !== null) out.push({ pid, cwd: line.slice(1) })
  }
  return out
}

const short = (sha) => (sha ? sha.slice(0, 8) : '?')
const keep = (reason) => ({ action: 'keep', reason })

/**
 * What to do with one linked worktree.
 *
 * facts: { appManaged, busy: pid[] | null, dirty: path[] | null, prs: [{ number, state, headRefOid }] | null, ahead: number | null }
 * A null fact could not be read, and an unread fact never leads to a removal.
 */
export function classify(wt, facts) {
  if (facts.appManaged) return keep('app-managed: archive its session in the Claude app')
  if (wt.prunable) return { action: 'prune', reason: 'its folder is gone; `git worktree prune` clears the entry' }
  if (wt.locked !== undefined) return keep(`locked${wt.locked ? ` (${wt.locked})` : ''}`)
  if (!wt.branch) return keep('detached HEAD: no branch to match against a PR')
  if (facts.busy === null) return keep('could not check for running processes (lsof failed)')
  if (facts.busy.length) {
    const many = facts.busy.length > 1
    return keep(`in use: pid${many ? 's' : ''} ${facts.busy.join(', ')} ${many ? 'have their' : 'has its'} working directory here`)
  }
  if (facts.dirty === null) return keep('could not read `git status` here')
  if (facts.dirty.length) {
    const shown = facts.dirty.slice(0, 3).join(', ')
    const more = facts.dirty.length > 3 ? `, +${facts.dirty.length - 3} more` : ''
    return keep(`${facts.dirty.length} uncommitted or untracked file(s): ${shown}${more}`)
  }
  if (facts.prs === null) return keep('could not read PRs from GitHub (gh)')

  const exact = facts.prs.find((p) => p.headRefOid === wt.head)
  if (exact?.state === 'MERGED') return { action: 'remove', reason: `PR #${exact.number} merged with this exact tip; clean` }
  if (exact?.state === 'OPEN') return keep(`PR #${exact.number} is still open: merge it, or close it on purpose`)
  if (exact) return keep(`PR #${exact.number} was closed without merging`)

  const merged = facts.prs.find((p) => p.state === 'MERGED')
  if (merged) {
    return keep(
      `commits after PR #${merged.number} merged (tip ${short(wt.head)}, PR head ${short(merged.headRefOid)}): ` +
        'land them on a new branch from dev',
    )
  }
  const open = facts.prs.find((p) => p.state === 'OPEN')
  if (open) return keep(`PR #${open.number} is open, and this tip is not pushed to it`)
  if (facts.ahead === 0) return keep('no PR, and nothing here that origin/dev lacks: remove it by hand if abandoned')
  if (facts.ahead === null) return keep('no PR')
  return keep(`no PR; ${facts.ahead} commit(s) not on origin/dev`)
}

function fail(message) {
  console.error(`\n✗ worktree sweep: ${message}\n`)
  process.exit(2)
}

/** stdout, or null when the command fails. */
function run(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  } catch {
    return null
  }
}

/** Every running process's working directory, or null when lsof is unavailable. */
function processCwds() {
  // lsof exits 1 when it cannot inspect some processes, with stdout still
  // complete for the rest, so judge by the output and not the status.
  const res = spawnSync('lsof', ['-w', '-a', '-d', 'cwd', '-F', 'pn'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (res.error || !res.stdout) return null
  return parseLsof(res.stdout)
}

function factsFor(wt, mainPath, cwds) {
  const appManaged = isInside(wt.path, join(mainPath, '.claude', 'worktrees'))
  if (appManaged || wt.prunable || wt.locked !== undefined || !wt.branch) return { appManaged }

  const busy = cwds === null ? null : [...new Set(cwds.filter((p) => isInside(p.cwd, wt.path)).map((p) => p.pid))]
  const status = run('git', ['-C', wt.path, 'status', '--porcelain', '--untracked-files=all'])
  const dirty = status === null ? null : status.split('\n').filter(Boolean).map((l) => l.slice(3))
  const json = run('gh', ['pr', 'list', '--head', wt.branch, '--state', 'all', '--limit', '30', '--json', 'number,state,headRefOid'], mainPath)
  const prs = json === null ? null : JSON.parse(json)
  const count = run('git', ['-C', mainPath, 'rev-list', '--count', `origin/dev..${wt.head}`])
  const ahead = count === null ? null : Number(count.trim())
  return { appManaged, busy, dirty, prs, ahead }
}

function main(argv) {
  const apply = argv.includes('--apply')
  const listing = run('git', ['worktree', 'list', '--porcelain'])
  if (listing === null) fail('not inside a git repository.')
  const [mainWt, ...linked] = parsePorcelain(listing)
  const top = realpathSync(run('git', ['rev-parse', '--show-toplevel']).trim())
  if (apply && top !== realpathSync(mainWt.path)) {
    fail(`--apply runs from the main checkout (${mainWt.path}), not from a linked worktree.\n  Run it without --apply to see the report.`)
  }

  const cwds = processCwds()
  const rows = linked.map((wt) => ({ wt, ...classify(wt, factsFor(wt, mainWt.path, cwds)) }))
  const where = (wt) => relative(mainWt.path, wt.path) || '.'

  console.log(`\nWorktrees of ${mainWt.path}${apply ? '' : ' (report only)'}\n`)
  if (!rows.length) console.log('  none besides the main checkout')
  const width = Math.max(0, ...rows.map((r) => where(r.wt).length))
  for (const { wt, action, reason } of rows) {
    console.log(`  ${action.padEnd(6)}  ${where(wt).padEnd(width)}  ${wt.branch ?? '(detached)'}`)
    console.log(`  ${''.padEnd(6)}  ${''.padEnd(width)}  ${reason}`)
  }

  const toRemove = rows.filter((r) => r.action === 'remove')
  const toPrune = rows.some((r) => r.action === 'prune')
  if (!apply) {
    if (toRemove.length || toPrune) console.log('\n  To remove them: `npm run worktrees -- --apply`, from the main checkout.')
    console.log('')
    return
  }

  let failed = 0
  for (const { wt } of toRemove) {
    // Re-read the tip: a session may have committed since the facts were read.
    const tip = run('git', ['-C', mainWt.path, 'rev-parse', `refs/heads/${wt.branch}`])?.trim()
    if (tip !== wt.head) {
      console.log(`\n  ✗ ${where(wt)}: ${wt.branch} moved to ${short(tip)} since the check; left alone`)
      failed++
      continue
    }
    const removed = spawnSync('git', ['-C', mainWt.path, 'worktree', 'remove', wt.path], { encoding: 'utf8' })
    if (removed.status !== 0) {
      console.log(`\n  ✗ ${where(wt)}: git worktree remove refused\n    ${removed.stderr.trim()}`)
      failed++
      continue
    }
    const deleted = spawnSync('git', ['-C', mainWt.path, 'branch', '-D', wt.branch], { encoding: 'utf8' })
    console.log(
      deleted.status === 0
        ? `\n  ✓ ${where(wt)}: removed, and branch ${wt.branch} (${short(wt.head)}) deleted`
        : `\n  ✗ ${where(wt)}: removed, but git branch -D failed\n    ${deleted.stderr.trim()}`,
    )
    if (deleted.status !== 0) failed++
  }
  if (toPrune) {
    const pruned = spawnSync('git', ['-C', mainWt.path, 'worktree', 'prune'], { encoding: 'utf8' })
    console.log(pruned.status === 0 ? '\n  ✓ pruned the entries whose folder is gone' : `\n  ✗ git worktree prune failed\n    ${pruned.stderr.trim()}`)
    if (pruned.status !== 0) failed++
  }
  if (!toRemove.length && !toPrune) console.log('\n  Nothing to remove.')
  console.log('')
  if (failed) process.exit(1)
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
