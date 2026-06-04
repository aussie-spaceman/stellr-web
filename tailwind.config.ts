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
          orange:       '#dda33b',
          'orange-alt': '#da6220',
          white:        '#fefefe',
          grey:         '#969696',
        },
      },
      fontFamily: {
        display: ['Archivo Black', 'system-ui', 'sans-serif'],
        heading: ['Norwester', 'system-ui', 'sans-serif'],
        subheading: ['Fredoka', 'system-ui', 'sans-serif'],
        sans: ['Aileron', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'display': ['60pt', { lineHeight: '1.1' }],
        'h1':      ['32pt', { lineHeight: '1.2' }],
        'h2':      ['24pt', { lineHeight: '1.3' }],
        'h3':      ['16pt', { lineHeight: '1.4' }],
        'body':    ['12pt', { lineHeight: '1.6' }],
        'caption': ['9pt',  { lineHeight: '1.4' }],
      },
    },
  },
  plugins: [],
}

export default config
