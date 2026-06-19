// Stellr design-token build (Style Dictionary v5).
// Source of truth: design/tokens.json (W3C DTCG format).
// Emits:
//   - styles/tokens.css  : :root CSS custom properties (the runtime spine)
//   - lib/tokens.ts      : typed nested object for TS / tailwind.config consumption
// Run with `npm run build:tokens` (also runs automatically via `prebuild`).
import StyleDictionary from 'style-dictionary'

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
