// Tailwind 4 runs as its own PostCSS plugin and does vendor prefixing itself
// (Lightning CSS), so autoprefixer is gone.
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
