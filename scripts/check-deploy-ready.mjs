#!/usr/bin/env node
// check-deploy-ready.mjs
//
// Guardrail against the failure mode where prod runs code — especially DB
// migrations — that was never committed/pushed to git (it happened: migration
// 127 + grade-logic were deployed while uncommitted, so main and prod diverged).
//
// Fails if the working tree is dirty or if the current branch has commits not
// pushed to its upstream. Run before deploying (or wire it as a git pre-push
// hook / into your deploy command):
//
//   npm run check:deploy-ready
//
// It is intentionally NOT part of `prebuild`, so local/dev builds aren't blocked.

import { execSync } from 'node:child_process'

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf8' }).trim()
}

let failed = false
function fail(msg) {
  console.error(`✗ ${msg}`)
  failed = true
}

// 1) Working tree must be clean — nothing uncommitted can reach a deploy.
const status = git('status --porcelain')
if (status) {
  const migrationLines = status
    .split('\n')
    .filter((l) => l.includes('supabase/migrations/'))
  fail('Working tree is not clean — commit or stash before deploying.')
  if (migrationLines.length) {
    console.error('  Uncommitted MIGRATION files (these must never deploy uncommitted):')
    for (const l of migrationLines) console.error(`    ${l}`)
  }
  console.error(git('status --short'))
}

// 2) The current branch must be fully pushed to its upstream.
let upstream = ''
try {
  upstream = git('rev-parse --abbrev-ref --symbolic-full-name @{u}')
} catch {
  fail('No upstream configured for the current branch — push it and set upstream before deploying.')
}
if (upstream) {
  const ahead = git(`rev-list --count ${upstream}..HEAD`)
  if (ahead !== '0') {
    fail(`Current branch is ${ahead} commit(s) ahead of ${upstream} — push before deploying.`)
    console.error(git(`log --oneline ${upstream}..HEAD`))
  }
}

if (failed) {
  console.error('\nDeploy readiness check FAILED — fix the above so git matches what will run in prod.')
  process.exit(1)
}
console.log('✓ deploy-ready: working tree clean and branch pushed.')
