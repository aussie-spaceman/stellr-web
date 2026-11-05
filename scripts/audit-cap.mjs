#!/usr/bin/env node
// The list of unaudited handlers only falls (docs/TENANCY-S5.md, C7).
// test/audit-coverage.test.ts compares the routes with the baseline in the same tree,
// so it cannot see a baseline regenerated with --allow-grow. This compares the
// baseline with the merge base.
//
//   node scripts/audit-cap.mjs --since <ref>
//
// Exit 1 when test/baselines/unaudited-mutations.json lists a handler the merge base
// does not. AUDIT_CAP_GROW_OK=true (the audit-cap-grow PR label) acknowledges it. Fails
// closed on a ref git cannot resolve or a baseline it cannot read. Raising measuredBy
// does not excuse growth: nothing proves the rules really changed, so seeing more needs
// the label too. Only a merge base from before baselines carried a version is not
// compared, which is how the list first gets one.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASELINE_FILE = 'test/baselines/unaudited-mutations.json'
const LISTS = ['mutations', 'crons', 'getMutations']

/** Every listed handler, or null when this is not a readable baseline. */
function listed(baseline) {
  if (!baseline || LISTS.some((l) => !Array.isArray(baseline[l]))) return null
  return LISTS.flatMap((l) => baseline[l])
}

/** Handlers `after` lists and `before` does not. */
export function capGrowth(before, after) {
  const was = new Set(listed(before))
  return listed(after).filter((k) => !was.has(k)).sort()
}

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

export function checkSince(root, ref) {
  let mergeBase
  let present
  try {
    mergeBase = git(root, 'merge-base', 'HEAD', ref).trim()
    present = git(root, 'ls-tree', '--name-only', mergeBase, BASELINE_FILE).trim()
  } catch {
    console.error(`--since: cannot find the merge base with ${ref}.`)
    return 1
  }
  const fullPath = path.join(root, BASELINE_FILE)
  if (!existsSync(fullPath)) {
    console.error(`--since: ${BASELINE_FILE} is missing from this tree.`)
    return 1
  }
  try {
    const after = JSON.parse(readFileSync(fullPath, 'utf8'))
    if (!listed(after)) throw new Error('lists')
    if (!present) {
      console.log(`--since: ${ref} has no ${BASELINE_FILE} yet; nothing to compare.`)
      return 0
    }
    const before = JSON.parse(git(root, 'show', `${mergeBase}:${BASELINE_FILE}`))
    if (!listed(before)) throw new Error('lists')
    const rulesChanged = before.measuredBy !== after.measuredBy
    const rules = rulesChanged ? `, measured by different rules (${before.measuredBy ?? 'unversioned'} -> ${after.measuredBy ?? 'unversioned'})` : ''
    const line = `Unaudited handlers: ${listed(before).length} -> ${listed(after).length}, since ${ref}${rules}`
    if (before.measuredBy === undefined && rulesChanged) {
      console.log(`${line}; not compared: the merge base predates versioned baselines.`)
      return 0
    }
    const grew = capGrowth(before, after)
    if (grew.length === 0) {
      console.log(`${line}.`)
      return 0
    }
    if (process.env.AUDIT_CAP_GROW_OK === 'true') {
      console.log(`${line}, acknowledged by the audit-cap-grow label.`)
      for (const k of grew) console.log(`  ${k}`)
      return 0
    }
    console.error(`${line}. The list only falls: a new mutating handler audits (withAudit, lib/audit/route.ts) or has an owner-approved exemption.`)
    for (const k of grew) console.error(`  ${k}`)
    return 1
  } catch {
    console.error(`--since: cannot read ${BASELINE_FILE}.`)
    return 1
  }
}

// Real paths on both sides: a symlink or a space in the path must not skip the check and exit 0.
if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  const at = process.argv.indexOf('--since')
  if (at < 0 || !process.argv[at + 1]) {
    console.error('usage: node scripts/audit-cap.mjs --since <ref>')
    process.exit(2)
  }
  process.exit(checkSince(process.cwd(), process.argv[at + 1]))
}
