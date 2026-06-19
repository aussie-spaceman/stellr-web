// One-shot Design System V2 sweep: cold Tailwind `gray-*` utilities → cool token
// neutrals. Reads newline-separated file paths from stdin. Auditable: prints a
// per-file replacement count and never touches non-gray utilities.
import { readFileSync, writeFileSync } from 'node:fs'

// Per-property shade → token maps (token utilities defined in tailwind.config.ts).
const TEXT = { 950: 'ink', 900: 'ink', 800: 'ink', 700: 'content-body', 600: 'content-body', 500: 'content-muted', 400: 'content-faint', 300: 'content-faint', 200: 'content-faint', 100: 'white', 50: 'white' }
const BG   = { 950: 'ink', 900: 'ink', 800: 'ink', 700: 'content-secondary', 600: 'content-secondary', 500: 'content-muted', 400: 'content-muted', 300: 'line', 200: 'line-light', 100: 'surface', 50: 'surface' }
const LINE = { 950: 'ink', 900: 'ink', 800: 'ink', 700: 'content-secondary', 600: 'content-muted', 500: 'content-faint', 400: 'line', 300: 'line', 200: 'line', 100: 'line-light', 50: 'line-light' }

const rules = [
  { re: /\b(text|placeholder|fill|stroke|decoration|caret)-gray-(\d{2,3})\b/g, map: TEXT },
  { re: /\b(bg|from|to|via)-gray-(\d{2,3})\b/g, map: BG },
  { re: /\b(border(?:-[trblxy])?|divide(?:-[xy])?|ring|outline|ring-offset)-gray-(\d{2,3})\b/g, map: LINE },
]

const files = readFileSync(0, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
let totalFiles = 0, totalSubs = 0
for (const f of files) {
  let src = readFileSync(f, 'utf8')
  let n = 0
  for (const { re, map } of rules) {
    src = src.replace(re, (m, prop, shade) => {
      const tok = map[shade]
      if (!tok) return m // leave unmapped shades untouched
      n++
      return `${prop}-${tok}`
    })
  }
  if (n > 0) { writeFileSync(f, src); totalFiles++; totalSubs += n; console.log(`${String(n).padStart(3)}  ${f}`) }
}
console.log(`\n✓ ${totalSubs} substitutions across ${totalFiles} files`)
