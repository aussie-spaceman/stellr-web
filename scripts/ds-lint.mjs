// Design-system guardrail. Fails the build if the OLD brand regresses into UI
// code — pre-V2 hex literals or the old font-family names used directly in
// components. Tokens (design/tokens.json → tailwind) are the only source of
// brand values; see CLAUDE.md.
//
// Scope: app/** (excluding app/api — server/email/PDF code legitimately uses
// raw hex), components/**, packages/**. Generated files are never scanned.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { classTokens, countArbitrary, countBrand, generatedBaseClasses, smallFormText, smallText, unknownColourClasses, weakControlBorder } from './ds-lint-classes.mjs'

const ROOTS = ['app', 'components', 'packages']
const SKIP = ['app/api', 'node_modules', '.next', 'storybook-static']
const EXT = /\.(ts|tsx|js|jsx)$/

// Pre-V2 brand palette — must never reappear in UI code.
const OLD_HEX = /#(0d439d|051535|1d5fd6|da6220|dda33b|c2410c|b67a1e|f4f1ea|e7e2d6|f0ece1|5b5648|8a8472|969696|374151)\b/gi
// Old font-family names — only valid in globals.css @font-face + tailwind config
// (the `font-competition` alias), never inline in components.
const OLD_FONT = /\b(Norwester|Aileron|Archivo Black|Fredoka)\b/g

function walk(dir, out = []) {
  if (SKIP.some((s) => dir === s || dir.startsWith(s + '/'))) return out
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e)
    if (SKIP.some((s) => p === s || p.startsWith(s + '/'))) continue
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (EXT.test(p)) out.push(p)
  }
  return out
}

const errors = []
const files = ROOTS.flatMap((root) => walk(root))
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(OLD_HEX)) errors.push(`${file}: pre-V2 brand hex ${m[0]} — use a token utility instead`)
  for (const m of src.matchAll(OLD_FONT)) errors.push(`${file}: old font "${m[0]}" in UI code — use font-sans/font-display (or font-competition for materials)`)
}

// Class checks (scripts/ds-lint-classes.mjs). Stories and tests are skipped:
// they render fixtures, not product UI.
const uiFiles = files.filter((f) => f.endsWith('.tsx') && !/\.(test|stories)\.tsx$/.test(f))
const generated = await generatedBaseClasses(uiFiles)
const counts = { smallFormText: 0, weakControlBorder: 0, arbitraryValues: 0, brandAliases: 0 }
for (const file of uiFiles) {
  const src = readFileSync(file, 'utf8')
  for (const cls of unknownColourClasses(classTokens(src), generated)) {
    errors.push(`${file}: \`${cls}\` is not a class Tailwind generates, so it styles nothing — use a token utility (tailwind.config.ts)`)
  }
  for (const cls of smallText(src)) errors.push(`${file}: \`${cls}\` is under the 12px type floor — use text-xs or larger`)
  counts.smallFormText += smallFormText(src)
  counts.weakControlBorder += weakControlBorder(src)
  counts.arbitraryValues += countArbitrary(src)
  counts.brandAliases += countBrand(src)
}

// Ratchets: may only go down. `node scripts/ds-lint.mjs --update-baseline`
// records lower counts after a clean-up.
const BASELINE = 'scripts/ds-lint-baseline.json'
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
const WHY = {
  smallFormText: 'text fields set below 16px (iOS zooms on focus): use fieldControlClass / text-input mouse:text-sm',
  weakControlBorder: 'text fields with a divider-weight border (needs 3:1): use border-line-strong',
  arbitraryValues: 'arbitrary-value classes (text-[13px], bg-[#…]): use the token scale',
  brandAliases: 'legacy brand-* aliases: use the semantic token names',
}
if (process.argv.includes('--update-baseline')) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n')
  console.log(`✓ ds-lint baseline updated: ${JSON.stringify(counts)}`)
}
for (const [key, n] of Object.entries(counts)) {
  if (n > baseline[key]) errors.push(`${n} ${WHY[key]} — the baseline is ${baseline[key]} (${BASELINE}); this change adds ${n - baseline[key]}`)
  else if (n < baseline[key]) console.log(`↓ ${key}: ${n} (baseline ${baseline[key]}) — run with --update-baseline to lock it in`)
}

if (errors.length) {
  console.error(`\n✗ design-system lint: ${errors.length} violation(s)\n`)
  for (const e of errors) console.error('  ' + e)
  console.error('\nBrand values come from design/tokens.json via Tailwind tokens. See CLAUDE.md.\n')
  process.exit(1)
}
console.log('✓ design-system lint: no pre-V2 brand regressions')
