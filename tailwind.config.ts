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
          'blue-bright':'#1d5fd6',  /* interactive highlight / hover / 2nd avatar */
          orange:       '#dda33b',  /* gold — Academy identity, progress */
          'orange-alt': '#da6220',  /* orange — Competitions identity, energy CTAs */
          'orange-deep':'#c2410c',  /* gradient end-stop for orange */
          'gold-ink':   '#b67a1e',  /* gold used as TEXT on white (contrast-safe) */
          white:        '#fefefe',  /* backgrounds only */
          'white-text': '#ffffff',  /* pure white for text/icons */
          grey:         '#969696',
          'grey-dark':  '#374151',
          'grey-light': '#f3f4f6',
          /* warm neutral system — replaces cold gray-* across the (member) app */
          canvas:       '#f4f1ea',  /* app background */
          surface:      '#ffffff',  /* cards */
          border:       '#e7e2d6',  /* card borders */
          hairline:     '#f0ece1',  /* inner dividers / progress track */
          muted:        '#5b5648',  /* body-muted text */
          'muted-soft': '#8a8472',  /* captions / metadata */
        },
      },
      fontFamily: {
        display: ['Archivo Black', 'system-ui', 'sans-serif'],
        heading: ['Norwester', 'system-ui', 'sans-serif'],
        subheading: ['Fredoka', 'system-ui', 'sans-serif'],
        sans: ['Aileron', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        /* real display scale — the (member) app previously topped out at text-2xl */
        'hero':    ['56px', { lineHeight: '1.0', letterSpacing: '-0.01em' }],
        'display': ['34px', { lineHeight: '1.05' }],
        'title':   ['30px', { lineHeight: '1.1', letterSpacing: '0.01em' }],
        'h1':      ['32pt', { lineHeight: '1.2' }],
        'h2':      ['24pt', { lineHeight: '1.3' }],
        'h3':      ['16pt', { lineHeight: '1.4' }],
        'body':    ['12pt', { lineHeight: '1.6' }],
        'caption': ['9pt',  { lineHeight: '1.4' }],
      },
      borderRadius: {
        'card':    '16px',
        'card-lg': '18px',
      },
      boxShadow: {
        'card':  '0 1px 3px rgba(10,23,51,.05)',
        'float': '0 30px 70px -20px rgba(5,21,53,.4)',
      },
    },
  },
  plugins: [],
}

export default config
