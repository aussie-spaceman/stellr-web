#!/usr/bin/env node
// The tenant-host cap only falls (docs/TENANCY-S5.md, C6). test/idor/tenant-host-routes.test.ts
// compares the routes with the baseline in the same tree, so it cannot see a baseline
// raised with IDOR_ALLOW_GROW. This compares the baseline with the merge base.
//
//   node scripts/tenant-host-cap.mjs --since <ref>
//
// The baseline holds totals and a hash, and names no route, so what prints here is counts
// and hashes. Exit 1 when a total below rose since the merge base with <ref> (capGrew,
// capRegressions). TENANT_HOST_CAP_GROW_OK=true (the tenant-host-cap-grow PR label)
// acknowledges it. Fails closed on a ref git cannot resolve or a baseline it cannot read.
//
// Totals cannot see cases trading places at the same rank. Only the hash moves then, and
// the suite fails until the baseline is regenerated, so a person sees the set locally.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const BASELINE_FILE = 'test/baselines/tenant-host-idor.json'

/** Worst last. leak and honey_write rank together: which of the two a route does is a detail. */
const FAILING_RANK = { oracle_4xx: 2, oracle: 3, leak: 4, honey_write: 4 }
/** The case ran and proved nothing: the id never got as far as anything that decides. */
export const UNPROVEN_ENTRIES = ['refused_untouched', 'ok_untouched', 'unexercised', 'error']

const outcomeOf = (entry) => entry.split(':')[0]

export const isFailingEntry = (entry) => outcomeOf(entry) in FAILING_RANK
export const isUnprovenEntry = (entry) => UNPROVEN_ENTRIES.includes(outcomeOf(entry))

/**
 * The totals that may not rise. The failing ones count a rank and everything worse, so a
 * case moving down the ranks raises none of them. Unproven counts alone, so a failing case
 * going to `error` or `unexercised` raises it: a failing case leaves the count by being
 * refused, or answered uniformly, with the id used.
 */
const CAPS = [
  ['leak or honey_write', (o) => FAILING_RANK[o] >= 4],
  ['oracle or worse', (o) => FAILING_RANK[o] >= 3],
  ['oracle_4xx or worse', (o) => FAILING_RANK[o] >= 2],
  ['unproven', isUnprovenEntry],
]

const capTotal = (byOutcome, counts) => Object.entries(byOutcome).reduce((sum, [outcome, n]) => (counts(outcome) ? sum + n : sum), 0)

/** Which capped totals rose between two baselines' totals, as counts. No totals before: nothing to compare. */
export function capRegressions(before, after) {
  if (!before) return []
  const out = []
  for (const [name, counts] of CAPS) {
    const was = capTotal(before.byOutcome, counts)
    const now = capTotal(after.byOutcome, counts)
    if (now > was) out.push(`${name}: ${was} -> ${now}`)
  }
  return out
}

/** True when either count is higher than at the merge base. No baseline there yet: nothing to compare. */
export function capGrew(before, after) {
  if (before === null) return false
  return after.totals.failing > before.totals.failing || after.totals.unproven > before.totals.unproven
}

/** Enough to compare: the merge base's baseline may be of an earlier shape, which holds these too. */
function readableTotals(baseline) {
  const t = baseline?.totals
  return (
    Number.isInteger(t?.failing) &&
    Number.isInteger(t?.unproven) &&
    t.byOutcome !== null &&
    typeof t.byOutcome === 'object' &&
    Object.values(t.byOutcome).every(Number.isInteger)
  )
}

/** This tree's baseline holds a hash and no list of cases. */
const readableHead = (baseline) => readableTotals(baseline) && /^[0-9a-f]{64}$/.test(baseline.caseHash) && !('cases' in baseline)

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

export function checkSince(root, ref) {
  let mergeBase
  try {
    mergeBase = git(root, 'merge-base', 'HEAD', ref).trim()
  } catch {
    console.error(`--since: cannot find the merge base with ${ref}.`)
    return 1
  }
  let listed = ''
  try {
    listed = git(root, 'ls-tree', '--name-only', mergeBase, BASELINE_FILE).trim()
  } catch {
    console.error(`--since: cannot read the tree at ${mergeBase}.`)
    return 1
  }
  const fullPath = path.join(root, BASELINE_FILE)
  if (!existsSync(fullPath)) {
    console.error(`--since: ${BASELINE_FILE} is missing from this tree.`)
    return 1
  }
  try {
    const after = JSON.parse(readFileSync(fullPath, 'utf8'))
    if (!readableHead(after)) throw new Error('shape')
    if (!listed) {
      console.log(`--since: ${ref} has no ${BASELINE_FILE} yet; nothing to compare.`)
      return 0
    }
    const before = JSON.parse(git(root, 'show', `${mergeBase}:${BASELINE_FILE}`))
    if (!readableTotals(before)) throw new Error('shape')
    const line =
      `Tenant-host cap: ${before.totals.failing} -> ${after.totals.failing} failing, ` +
      `${before.totals.unproven} -> ${after.totals.unproven} unproven, ` +
      `case hash ${before.caseHash ?? 'none'} -> ${after.caseHash}, since ${ref}`
    const worse = capRegressions(before.totals, after.totals)
    if (!capGrew(before, after) && worse.length === 0) {
      console.log(`${line}.`)
      if (before.caseHash && before.caseHash !== after.caseHash) {
        console.log('The case set moved and no total rose. Totals cannot rank that: the reviewer checks that the regeneration was meant.')
      }
      return 0
    }
    if (process.env.TENANT_HOST_CAP_GROW_OK === 'true') {
      console.log(`${line}, acknowledged by the tenant-host-cap-grow label.`)
      for (const w of worse) console.log(`  ${w}`)
      return 0
    }
    console.error(`${line}. The cap only falls: a route a tenant host serves must not answer for another tenant's record.`)
    for (const w of worse) console.error(`  ${w}`)
    return 1
  } catch {
    console.error(`--since: cannot read ${BASELINE_FILE}.`)
    return 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const at = process.argv.indexOf('--since')
  if (at < 0 || !process.argv[at + 1]) {
    console.error('usage: node scripts/tenant-host-cap.mjs --since <ref>')
    process.exit(2)
  }
  process.exit(checkSince(process.cwd(), process.argv[at + 1]))
}
