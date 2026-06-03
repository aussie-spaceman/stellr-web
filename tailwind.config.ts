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
        // Placeholder brand tokens — swap for final brand palette when assets arrive
        brand: {
          navy:    '#0A0F1E',
          blue:    '#2563EB',
          'blue-hover': '#1D4ED8',
          white:   '#FFFFFF',
          'grey-light': '#F3F4F6',
          'grey-mid':   '#9CA3AF',
          'grey-dark':  '#374151',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
