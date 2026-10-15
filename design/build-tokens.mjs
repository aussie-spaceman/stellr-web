// Stellr design-token build (Style Dictionary v5).
// Source of truth: design/tokens.json (W3C DTCG format).
// Emits:
//   - styles/tokens.css  : :root CSS custom properties (the runtime spine)
//   - lib/tokens.ts      : typed nested object for TS / tailwind.config consumption
// Run with `npm run build:tokens` (also runs automatically via `prebuild`).
import { readFileSync } from 'node:fs'
import StyleDictionary from 'style-dictionary'
import { contrastFailures } from './contrast-gate.mjs'

// Contrast first: a palette that fails WCAG AA doesn't get built.
const failures = contrastFailures(JSON.parse(readFileSync(new URL('./tokens.json', import.meta.url), 'utf8')))
if (failures.length) {
  console.error(`✗ design tokens fail the contrast gate (design/contrast-gate.mjs):\n  ${failures.join('\n  ')}`)
  process.exit(1)
}

// Custom format: a nested, typed TS object rebuilt from each token's path.
StyleDictionary.registerFormat({
  name: 'ts/nested',
  format: ({ dictionary }) => {
    const root = {}
    for (const token of dictionary.allTokens) {
      const value = token.$value !== undefined ? token.$value : token.value
      let node = root
      token.path.forEach((seg, i) => {
        if (i === token.path.length - 1) node[seg] = value
        else node = node[seg] ??= {}
      })
    }
    return (
      '// AUTO-GENERATED from design/tokens.json — do not edit by hand.\n' +
      '// Regenerate with `npm run build:tokens`.\n' +
      `export const tokens = ${JSON.stringify(root, null, 2)} as const\n` +
      'export default tokens\n'
    )
  },
})

const sd = new StyleDictionary({
  source: ['design/tokens.json'],
  usesDtcg: true, // tokens.json uses $value / $type
  platforms: {
    css: {
      // Minimal transforms: kebab names + normalised colours; keep px/em literals.
      transforms: ['attribute/cti', 'name/kebab', 'color/css'],
      buildPath: 'styles/',
      files: [{ destination: 'tokens.css', format: 'css/variables' }],
    },
    ts: {
      transforms: ['attribute/cti', 'name/kebab'],
      buildPath: 'lib/',
      files: [{ destination: 'tokens.ts', format: 'ts/nested' }],
    },
  },
})

await sd.buildAllPlatforms()
console.log('✓ tokens built → styles/tokens.css, lib/tokens.ts')
