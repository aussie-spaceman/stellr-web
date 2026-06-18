# 01 · Design Tokens — paste-ready diffs

Everything here maps to assets already in the repo. Apply these two diffs first; they unblock the whole global sweep.

## A) `tailwind.config.ts`

The brand colors and font aliases already exist. **Add** the warm neutrals + bright blue (the bracketed `[add]` rows). Keep the existing keys.

```ts
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './sanity/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          blue:         '#0d439d',
          'blue-dark':  '#051535',
          'blue-bright':'#1d5fd6', // [add] interactive highlight / hover / 2nd avatar
          orange:       '#dda33b', // gold — Academy identity, progress
          'orange-alt': '#da6220', // orange — Competitions identity, energy CTAs
          'orange-deep':'#c2410c', // [add] gradient end-stop for orange
          'gold-ink':   '#b67a1e', // [add] gold used as TEXT on white (contrast-safe)
          white:        '#fefefe',
          'white-text': '#ffffff',
          grey:         '#969696',
          'grey-dark':  '#374151',
          'grey-light': '#f3f4f6',
          // [add] — warm neutral system; replaces cold gray-* across the app
          canvas:       '#f4f1ea', // app background
          surface:      '#ffffff', // cards
          border:       '#e7e2d6', // card borders
          hairline:     '#f0ece1', // inner dividers / progress track
          muted:        '#5b5648', // body-muted text
          'muted-soft': '#8a8472', // captions / metadata
        },
      },
      fontFamily: {
        display: ['Archivo Black', 'system-ui', 'sans-serif'],
        heading: ['Norwester', 'system-ui', 'sans-serif'],
        subheading: ['Fredoka', 'system-ui', 'sans-serif'],
        sans: ['Aileron', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // [add/adjust] a real display scale (the app currently tops out at text-2xl)
        'hero':    ['56px', { lineHeight: '1.0', letterSpacing: '-0.01em' }],
        'display': ['34px', { lineHeight: '1.05' }],
        'title':   ['30px', { lineHeight: '1.1', letterSpacing: '0.01em' }],
        'h1':      ['32pt', { lineHeight: '1.2' }],
        'h2':      ['24pt', { lineHeight: '1.3' }],
        'h3':      ['16pt', { lineHeight: '1.4' }],
        'body':    ['12pt', { lineHeight: '1.6' }],
        'caption': ['9pt',  { lineHeight: '1.4' }],
      },
      borderRadius: { 'card': '16px', 'card-lg': '18px' }, // [add]
      boxShadow: {
        'card': '0 1px 3px rgba(10,23,51,.05)',            // [add]
        'float': '0 30px 70px -20px rgba(5,21,53,.4)',     // [add]
      },
    },
  },
  plugins: [],
}

export default config
```

## B) `styles/globals.css`

The `@font-face` blocks and the Google import already load all four faces — keep them. Change the body background to canvas, and add brand-aware component classes. **Replace** the existing `@layer base body` rule and the `.btn-*` block with these:

```css
@layer base {
  html {
    font-family: 'Aileron', system-ui, sans-serif;
    scroll-behavior: smooth;
  }
  body {
    @apply bg-brand-canvas text-brand-blue-dark;   /* was bg-brand-white */
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: 'Norwester', system-ui, sans-serif;
    @apply leading-tight;
  }
}

@layer components {
  /* App surface primitives */
  .app-card   { @apply rounded-2xl border border-brand-border bg-white shadow-card; }
  .eyebrow    { @apply font-subheading font-semibold uppercase tracking-[0.14em] text-xs; }
  .screen-title { @apply font-heading uppercase text-title text-brand-blue-dark; }

  /* Buttons — brand, not gray */
  .btn-primary {
    @apply inline-flex items-center justify-center px-5 py-3 rounded-xl bg-brand-blue
           text-white font-subheading font-medium text-sm transition-colors
           hover:bg-brand-blue-dark focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-2;
  }
  .btn-energy { /* high-intent CTAs (Register, Start) */
    @apply inline-flex items-center justify-center px-5 py-3 rounded-xl bg-brand-orange-alt
           text-white font-subheading font-medium text-sm transition-colors hover:bg-brand-orange-deep
           focus:outline-none focus:ring-2 focus:ring-brand-orange-alt focus:ring-offset-2;
  }
  .btn-secondary {
    @apply inline-flex items-center justify-center px-5 py-3 rounded-xl border-2 border-brand-blue
           text-brand-blue font-subheading font-medium text-sm transition-colors
           hover:bg-brand-blue hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-2;
  }

  .section-padding { @apply py-16 px-4 sm:px-6 lg:px-8; }
  .container-max   { @apply max-w-7xl mx-auto; }

  .input-field {
    @apply w-full rounded-lg border border-brand-border px-3 py-2.5 text-sm text-brand-blue-dark bg-white
           focus:outline-none focus:ring-2 focus:ring-brand-blue focus:border-transparent placeholder:text-brand-muted-soft;
  }
  .label-text { @apply block text-sm font-medium text-brand-blue-dark mb-1; }
}
```

## C) Section color map (single source — mirror in a TS const)

```ts
// lib/ui/sections.ts  [new — optional but recommended]
export const SECTION = {
  competitions: { fill: '#da6220', text: '#da6220',  tw: 'orange-alt' },
  community:    { fill: '#0d439d', text: '#0d439d',  tw: 'blue' },
  academy:      { fill: '#dda33b', text: '#b67a1e',  tw: 'orange' }, // gold; use gold-ink as text on white
} as const
```

## D) Global find/replace map (the "monochrome → brand" sweep)
Apply across `app/(member)/**` and `components/**` (NOT `(admin)` unless noted):

| Find | Replace with |
|---|---|
| `bg-gray-50` | `bg-brand-canvas` |
| `bg-white` (cards) | keep, but add `border-brand-border shadow-card rounded-2xl` |
| `border-gray-200` / `border-gray-100` | `border-brand-border` / `border-brand-hairline` |
| `text-gray-900` | `text-brand-blue-dark` |
| `text-gray-700` | `text-brand-muted` |
| `text-gray-500` / `text-gray-400` | `text-brand-muted-soft` |
| `bg-gray-900` (buttons, chat bubbles) | `bg-brand-blue` |
| `indigo-500` / `indigo-600` (badges, tabs) | `brand-blue` (or `brand-orange-alt` for "new"/energy) |
| `text-amber-600` (locked/upgrade) | `text-brand-gold-ink` |
| green progress (`text-green-500`) | `text-brand-orange` (gold) |
| module cover `from-gray-900 to-gray-700` | section gradient (see Academy in README §3) |

Typographic pass: section headings → `font-heading uppercase`; card titles/labels/buttons → `font-subheading`; the welcome name / big numbers → `font-display`.
