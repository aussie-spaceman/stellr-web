// design-sync: the app's CSS reads its faces through --font-space-grotesk and
// --font-hanken-grotesk, which next/font sets on <html> (lib/fonts.ts). With
// no next/font outside the app those vars are undefined, and a font-family
// built on an undefined var() is invalid - text falls back to the browser
// default. Define them once, at bundle load, pointing at the @font-face
// families shipped in fonts/ (see .design-sync/fonts/brand-fonts.css).
if (typeof document !== 'undefined' && !document.getElementById('stellr-font-vars')) {
  const style = document.createElement('style')
  style.id = 'stellr-font-vars'
  style.textContent =
    ":root{--font-space-grotesk:'Space Grotesk';--font-hanken-grotesk:'Hanken Grotesk'}"
  document.head.appendChild(style)
}
export {}
