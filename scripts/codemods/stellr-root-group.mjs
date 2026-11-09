// S5 B5c: moves Stellr's route groups under app/(stellr) and rewrites every path that
// names them. URLs do not change, because a route group is not part of one.
//
//   node scripts/codemods/stellr-root-group.mjs
//
// Safe to run again: a group already moved is skipped, and a rewritten path no longer
// matches. Run it again after merging another branch that added a page or a path under
// the old folders. Docs are left out, on purpose: Lane D owns them.
//
// The baselines key on file paths, and their own --write reads a moved file as one
// removed and one new, which would lose every reason a person wrote. So the path is
// rewritten here and nothing else, and the scripts then put each file in their order:
//
//   npx tsx scripts/s5-inventory.mjs --write
//   npx tsx scripts/authz-idioms.mjs --write
//   npx tsx scripts/tenant-surface-baseline.mjs --write
//   npm run idor:snapshot

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const TOP_LEVEL = ['(public)', '(member)', '(admin)', '(flow)', '(auth)', 'studio']

const SKIPPED = [
  /^docs\//,
  /^\.claude\//,
  /^supabase\//,
  /^e2e\/tenancy\/stellr-document-(base|head)\.json$/,
  /^scripts\/codemods\/stellr-root-group\.mjs$/,
  /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|otf|ttf|mp4|wasm|lock)$/,
]

// `app/(public)`, its regex-escaped forms, and `app/studio`. Preceded by a non-path
// character, so a path such as `.next/server/app/` or `my-app/(public)` is left alone.
const PATH = /(^|[^\w./-])((?:@\/)?app(?:\/|\\\/))(\\?\((?:public|member|admin|flow|auth)\\?\)|studio\b)/gm

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

function moveGroups() {
  mkdirSync('app/(stellr)', { recursive: true })
  for (const folder of TOP_LEVEL) {
    if (existsSync(`app/${folder}`)) git('mv', `app/${folder}`, `app/(stellr)/${folder}`)
  }
}

function rewritePaths() {
  let changed = 0
  for (const file of git('ls-files', '-z').split('\0').filter(Boolean)) {
    if (SKIPPED.some((re) => re.test(file)) || !existsSync(file)) continue
    const before = readFileSync(file, 'utf8')
    if (before.includes('\0')) continue
    const after = before.replace(PATH, (_, lead, app, folder) => {
      const slash = app.includes('\\/') ? '\\/' : '/'
      const group = folder.startsWith('\\') ? '\\(stellr\\)' : '(stellr)'
      return `${lead}${app}${group}${slash}${folder}`
    })
    if (after !== before) {
      writeFileSync(file, after)
      changed += 1
    }
  }
  return changed
}

moveGroups()
console.log(`Rewrote paths in ${rewritePaths()} files.`)
