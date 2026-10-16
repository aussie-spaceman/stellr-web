// Contrast gate for design/tokens.json (mobile review A1). `npm run
// build:tokens` runs it before generating anything, and `prebuild` runs that,
// so a token edit that drops a pairing below WCAG AA fails the build.
//
// Each check is a pairing the design actually uses: text colours on the
// backgrounds they sit on, fills that carry white or ink text, and control
// edges. 4.5:1 for text, 3:1 for UI parts (WCAG 1.4.3 / 1.4.11).

/** [foreground path, background path, minimum ratio, what uses it] */
export const CHECKS = [
  // Text on light backgrounds.
  ...['color.ink', 'color.text.primary', 'color.text.body', 'color.text.secondary', 'color.text.muted', 'color.text.faint',
    'color.primary', 'color.primaryDeep', 'color.spaceViolet', 'color.goldInk', 'color.danger',
    'themeTint.spaceText', 'themeTint.enviroText']
    .flatMap((fg) => [
      [fg, 'color.white', 4.5, 'text on white'],
      [fg, 'color.surface', 4.5, 'text on the surface background'],
    ]),
  // Theme chips.
  ['themeTint.spaceText', 'themeTint.spaceChip', 4.5, 'space chip label'],
  ['themeTint.enviroText', 'themeTint.enviroChip', 4.5, 'environmental chip label'],
  ['themeTint.enviroText', 'themeTint.enviroBg', 4.5, 'environmental note text'],
  ['color.primaryDeep', 'themeTint.primarySoftBg', 4.5, 'selected item on the soft blue wash'],
  // Audience chips (MembershipExplorer, bracketPalette): deep tone on its tint.
  ...['school', 'college', 'adult'].map((k) => [`bracket.${k}Deep`, `bracket.${k}Tint`, 4.5, 'audience chip on its tint']),
  // Text on the dark hero, footer and rails.
  ...['color.white', 'color.heroLead', 'color.heroDim', 'color.heroMuted'].map((fg) => [fg, 'color.midnight', 4.5, 'text on midnight']),
  ['color.heroLead', 'color.ink', 4.5, 'admin rail text on ink'],
  // Fills that carry white text: buttons, badges, tier CTAs (tier-shades.tsx).
  ...['color.primary', 'color.primaryDeep', 'color.danger', 'color.spaceViolet', 'color.ink',
    'bracket.schoolDeep', 'tier.pathfinder', 'tier.scholar',
    'bracket.collegeDeep', 'tier.contributor', 'tier.counselor',
    'bracket.adultDeep', 'tier.innovator', 'tier.trailblazer']
    .map((bg) => ['color.white', bg, 4.5, 'white text on a fill']),
  // Fills too light for white text carry ink instead.
  ...['color.donateGold', 'color.pathwayAmber', 'color.starGold'].map((bg) => ['color.ink', bg, 4.5, 'ink text on a gold/amber fill']),
  // Non-text: control edges and graphics.
  ['color.borderStrong', 'color.white', 3, 'form-control border'],
  ['color.primary', 'color.white', 3, 'focus ring / selected control'],
  ['color.enviroGreen', 'color.white', 3, 'environmental icon / fill'],
]

const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`)
  const [r, g, b] = m[1].match(/../g).map((x) => channel(parseInt(x, 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function valueAt(tokens, path) {
  const node = path.split('.').reduce((n, k) => n?.[k], tokens)
  const value = node?.$value
  if (typeof value !== 'string') throw new Error(`contrast gate: no colour token at ${path}`)
  return value
}

/** Every failing pairing, as readable lines. Empty when all pass. */
export function contrastFailures(tokens, checks = CHECKS) {
  const out = []
  for (const [fg, bg, min, use] of checks) {
    const ratio = contrast(valueAt(tokens, fg), valueAt(tokens, bg))
    if (ratio + 1e-9 < min) out.push(`${fg} on ${bg}: ${ratio.toFixed(2)}:1, needs ${min}:1 (${use})`)
  }
  return out
}
