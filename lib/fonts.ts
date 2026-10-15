import { Hanken_Grotesk, Space_Grotesk } from 'next/font/google'

// Design System V2 faces, self-hosted by next/font: the files are served from
// this site and preloaded, so first paint no longer waits on a stylesheet
// @import from fonts.googleapis.com and then a third origin for the files.
// Both are variable fonts (one file each covers every weight), and next/font
// adds size-matched fallbacks so text doesn't jump when the font arrives.
//
// The CSS variables feed tailwind.config.ts (font-display / font-sans …) and
// the base rules in styles/globals.css. The family names in design/tokens.json
// stay as the named fallback after each variable.
export const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-space-grotesk',
})

export const hankenGrotesk = Hanken_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-hanken-grotesk',
})

/** Class names that define both font variables; set on <html>. */
export const fontVariables = `${spaceGrotesk.variable} ${hankenGrotesk.variable}`
