// Design-system class checks (mobile review G4), run by scripts/ds-lint.mjs.
//
//  1. Unknown colour/border classes: a class like `text-brand-grey-mid` that
//     Tailwind doesn't generate renders as nothing (the cookie banner's text
//     was in the browser default colour for months). Hard failure.
//  2. Form text below 16px: an <input>/<select>/<textarea> with text-sm or
//     text-xs and no 16px rule makes iOS zoom the page on focus. Ratcheted.
//  3. Arbitrary values (`text-[13px]`, `bg-[#…]`) and legacy `brand-*`
//     aliases: counted against scripts/ds-lint-baseline.json so they can only
//     go down. Lower the baseline in the same change that removes some.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import loadConfig from 'tailwindcss/loadConfig.js'

// Utilities that take a colour (or a named token) after the prefix.
const COLOUR_PREFIX = '(?:text|bg|border|border-[trblxy]|ring|ring-offset|from|to|via|fill|stroke|divide|placeholder|outline|decoration|accent|caret|shadow)'
// A named, non-arbitrary class with that prefix, optional variants and opacity.
const COLOUR_CLASS = new RegExp(`^(?:[a-z0-9-]+:)*!?-?${COLOUR_PREFIX}-[a-z][a-z0-9-]*(?:\\/\\d+)?$`)

/** Class-like tokens from string literals in a TS/TSX source. */
export function classTokens(src) {
  const out = []
  for (const m of src.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
    const text = m[2]
    // A class string reads like several space-separated utilities, or sits in
    // a className attribute.
    const before = src.slice(Math.max(0, m.index - 12), m.index)
    const tokens = text.split(/\s+/).filter(Boolean)
    if (!/className=\{?$/.test(before) && !tokens.some((t) => /^(?:[a-z0-9-]+:)*-?[a-z]+-[a-z0-9]/.test(t) && t.includes('-'))) continue
    for (const t of tokens) if (!t.includes('${')) out.push(t)
  }
  return out
}

/** Classes Tailwind actually generates for these files, without variants. */
export async function generatedBaseClasses(files) {
  const config = loadConfig(resolve('tailwind.config.ts'))
  const css = await postcss([tailwind({ ...config, content: files })]).process(readFileSync('styles/globals.css', 'utf8'), {
    from: 'styles/globals.css',
  })
  const names = new Set()
  css.root.walkRules((rule) => {
    for (const m of rule.selector.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)) {
      const cls = m[1].replace(/\\(.)/g, '$1')
      names.add(baseOf(cls))
    }
  })
  return names
}

/** `md:hover:!text-ink/80` → `text-ink/80`: the utility without variants or `!`. */
export function baseOf(cls) {
  let depth = 0
  let last = 0
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] === '[') depth++
    else if (cls[i] === ']') depth--
    else if (cls[i] === ':' && depth === 0) last = i + 1
  }
  return cls.slice(last).replace(/^!/, '')
}

export function unknownColourClasses(tokens, generated) {
  return [...new Set(tokens.filter((t) => COLOUR_CLASS.test(t) && !generated.has(baseOf(t))))]
}

/** Every <input>/<select>/<textarea> start tag, braces and quotes respected. */
function controlTags(src) {
  const tags = []
  for (const m of src.matchAll(/<(input|select|textarea)\b/g)) {
    let depth = 0
    let quote = null
    let i = m.index + m[0].length
    for (; i < src.length; i++) {
      const c = src[i]
      if (quote) {
        if (c === quote && src[i - 1] !== '\\') quote = null
      } else if (c === '"' || c === "'" || c === '`') quote = c
      else if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    tags.push({ tag: m[1], text: src.slice(m.index, i + 1) })
  }
  return tags
}

const NOT_TEXT = /type=["'](?:checkbox|radio|range|color|file|hidden|submit|button|reset|image)["']/

/** Text fields whose classes set them below 16px with no 16px rule. */
export function smallFormText(src) {
  return controlTags(src).filter(
    ({ tag, text }) =>
      !(tag === 'input' && NOT_TEXT.test(text)) &&
      /(?:^|[\s"'`])(?:text-sm|text-xs|text-\[1[0-5](?:\.\d+)?px\])(?=[\s"'`])/.test(text) &&
      !/text-input|text-base|mouse:text-|fieldControlClass|input-field/.test(text),
  ).length
}

/** Text fields drawn with a divider-weight border (1.2:1; WCAG 1.4.11 wants 3:1). */
export function weakControlBorder(src) {
  return controlTags(src).filter(
    ({ tag, text }) =>
      !(tag === 'input' && NOT_TEXT.test(text)) &&
      /(?:^|[\s"'`])(?:border-line|border-line-light|border-brand-border|border-brand-hairline|border-gray-[123]00)(?=[\s"'`])/.test(text) &&
      !/border-line-strong|fieldControlClass|input-field/.test(text),
  ).length
}

/** Text set under the 12px floor (mobile review L9). */
export const smallText = (src) => [...src.matchAll(/(?<![-\w\[])(?:[a-z0-9-]+:)*text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/g)].map((m) => m[0])

export const countArbitrary = (src) => (src.match(/(?:^|[\s"'`])(?:[a-z0-9-]+:)*!?-?[a-z]+(?:-[a-z]+)*-\[[^\]\s]+\]/g) ?? []).length
export const countBrand = (src) =>
  (src.match(/(?:^|[\s"'`])(?:[a-z0-9-]+:)*!?(?:text|bg|border|ring|from|to|via|fill|stroke|divide|outline|decoration|shadow)-brand-[a-z-]+/g) ?? []).length
