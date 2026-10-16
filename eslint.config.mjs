// deep review TEST-12: a MINIMAL, non-blocking ESLint config for the specific
// classes the review cares about — nothing else. `tsc` cannot catch any of them.
//
// Deliberately NOT wired into `next build` (next.config: eslint.ignoreDuringBuilds)
// nor the `verify`/`prebuild` gate, and every enabled rule is 'warn', so it never
// fails CI. Run it on demand with `npm run lint`.
//
// Why 'warn', not 'error': `no-floating-promises` would otherwise fail on the
// pre-existing QUAL-1 fire-and-forget sites, which are a separate, still-open
// finding — enforcing here would just block on work this config is not meant to
// do. So it stays advisory: it surfaces NEW offenders in review, and a later
// pass can fix QUAL-1 and ratchet these rules to 'error'.
//
// The plugins below are registered but mostly left at their defaults (off); they
// exist so the repo's pre-existing `// eslint-disable-next-line <rule>` comments
// (@typescript-eslint/*, @next/next/*, react-hooks/*) resolve to a known rule
// instead of erroring, and reportUnusedDisableDirectives is off so a dormant
// directive is not reported as noise.
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import nextPlugin from '@next/eslint-plugin-next'
import jsxA11y from 'eslint-plugin-jsx-a11y'

/** A preset's enabled rules, each downgraded to 'warn' (options kept); its 'off' rules stay off. */
function asWarnings(rules) {
  const level = (v) => (Array.isArray(v) ? v[0] : v)
  return Object.fromEntries(
    Object.entries(rules)
      .filter(([, v]) => level(v) !== 'off' && level(v) !== 0)
      .map(([rule, v]) => [rule, Array.isArray(v) ? ['warn', ...v.slice(1)] : 'warn']),
  )
}

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'storybook-static/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      'scripts/**',
      'e2e/**',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.js',
      '**/*.jsx',
    ],
  },

  // Base: parse every TS/TSX file with the typescript-eslint parser (JSX on) and
  // register the plugins whose rules the codebase's disable directives name, so
  // the scoped blocks below need not repeat the parser and no directive errors
  // on an unknown rule. No rules and no typed program here, so it stays fast.
  {
    files: ['**/*.{ts,tsx}'],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
      '@next/next': nextPlugin,
    },
  },

  // Type-aware: a promise dropped in a route handler or lib is killed when the
  // Vercel function returns (deep review QUAL-1). Only this one rule is enabled;
  // the typed program is built only for these paths.
  {
    files: ['app/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}', 'proxy.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: { '@typescript-eslint/no-floating-promises': 'warn' },
  },

  // The shared web-ui must stay framework-light (CLAUDE.md): pass the router's
  // link via `as`/`linkAs`, don't hard-wire next/link or next/image.
  {
    files: ['packages/web-ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          paths: [
            { name: 'next/link', message: 'web-ui is framework-light: pass the router link via `as`/`linkAs` (CLAUDE.md).' },
            { name: 'next/image', message: 'web-ui is framework-light: do not hard-wire next/image (CLAUDE.md).' },
          ],
        },
      ],
    },
  },

  // React hooks correctness (not type-aware).
  {
    files: ['app/**/*.tsx', 'components/**/*.tsx', 'packages/**/*.tsx'],
    rules: {
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Accessibility (mobile review G3) and Next's own rules (raw <img>, etc.).
  // Warnings, but `verify` runs `npm run lint:ci` with --max-warnings set to
  // the current count (package.json), so the count can only go down: fix
  // some, then lower the number in the same PR.
  {
    files: ['app/**/*.tsx', 'components/**/*.tsx', 'packages/**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      ...asWarnings(jsxA11y.flatConfigs.recommended.rules),
      ...asWarnings(nextPlugin.configs.recommended.rules),
      // A <label> must name a control (WCAG 1.3.1): tapping it focuses the
      // field, and a screen reader announces the field by it. The shared Field
      // primitive does this for you (packages/web-ui/src/forms.tsx).
      // A scrollable region or chat log must be focusable to be scrolled from
      // the keyboard (WCAG 2.1.1): tabIndex={0} on those roles is intended.
      'jsx-a11y/no-noninteractive-tabindex': ['warn', { roles: ['tabpanel', 'region', 'log'], tags: [] }],
      'jsx-a11y/label-has-associated-control': [
        'warn',
        { assert: 'either', depth: 3, controlComponents: ['Input', 'Select', 'Textarea'] },
      ],
    },
  },
)
