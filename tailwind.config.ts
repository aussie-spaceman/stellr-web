import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'
import { tokens } from './lib/tokens'

/* Design System V2 (Claude Design) — generated tokens are the single source of
 * truth (design/tokens.json → lib/tokens.ts via `npm run build:tokens`).
 * The `brand-*` aliases are intentionally remapped onto the new token values so
 * the existing component code re-skins to the new brand without per-file edits;
 * new code should prefer the semantic names (primary, ink, surface, …). */
const c = tokens.color
const t = tokens.themeTint

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './packages/**/*.{ts,tsx}',
    './sanity/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        /* ── New canonical semantic palette ──────────────────────────── */
        midnight:     { DEFAULT: c.midnight, deep: c.midnightDeep },
        'hero-lead':  c.heroLead,
        'hero-dim':   c.heroDim,
        'hero-muted': c.heroMuted, // secondary text on midnight (footer legal row)
        ink:          c.ink,
        'utility-navy': c.utilityNavy,
        surface:      c.surface,
        primary: {
          DEFAULT: c.primary,
          deep:    c.primaryDeep,
          soft:    t.primarySoftBg,
        },
        'space-violet': { DEFAULT: c.spaceViolet, bg: t.spaceBg, chip: t.spaceChip, text: t.spaceText },
        'enviro-green': { DEFAULT: c.enviroGreen, bg: t.enviroBg, chip: t.enviroChip, text: t.enviroText },
        'pathway-amber': { DEFAULT: c.pathwayAmber, deep: c.pathwayAmberDeep, bg: t.amberSoftBg },
        'donate-gold': c.donateGold,
        'gold-ink':    c.goldInk,    // gold/amber as TEXT on white; fills carry ink text
        'star-gold':   c.starGold,
        'avatar-teal': c.avatarTeal,
        // The adults bracket's teal (design/tokens.json bracket.adult*): `deep` passes
        // as text on white and under white text; the base is for fills and icons.
        'adult-teal': { DEFAULT: tokens.bracket.adult, deep: tokens.bracket.adultDeep },
        line:        c.border,
        'line-light': c.borderLight,
        'line-strong': c.borderStrong, // form-control borders (≥3:1)
        danger:      c.danger,
        content: {
          DEFAULT:   c.text.primary,
          body:      c.text.body,
          secondary: c.text.secondary,
          muted:     c.text.muted,
          faint:     c.text.faint,
        },

        /* ── Legacy `brand-*` aliases, remapped to V2 values ─────────────
         * Keeps the existing ~193 files rendering in the new brand. These
         * are migrated to semantic names during the page-by-page rollout. */
        brand: {
          blue:         c.primary,      // navy #0d439d → bright #3C6DF6
          'blue-dark':  c.ink,          // near-black headings/text → ink
          'blue-bright':c.primaryDeep,  // hover
          orange:       c.donateGold,   // Academy gold
          'orange-alt': c.pathwayAmber, // Competitions / energy → amber
          'orange-deep':'#C2722A',      // amber gradient end (handoff)
          'gold-ink':   c.goldInk,      // gold text on white (A1: #C2722A was 3.7:1)
          white:        c.white,
          'white-text': c.white,
          grey:         c.text.faint,
          'grey-dark':  c.text.secondary,
          'grey-light': c.surface,
          canvas:       c.surface,      // warm canvas → cool surface
          surface:      c.white,        // cards
          border:       c.border,       // warm → cool border
          hairline:     c.borderLight,
          muted:        c.text.body,
          'muted-soft': c.text.muted,
        },
      },
      fontFamily: {
        /* next/font variables first (lib/fonts.ts), then the token family name */
        display:     ['var(--font-space-grotesk)', tokens.font.display, 'system-ui', 'sans-serif'], // Space Grotesk
        heading:     ['var(--font-space-grotesk)', tokens.font.display, 'system-ui', 'sans-serif'], // was Norwester
        subheading:  ['var(--font-hanken-grotesk)', tokens.font.body, 'system-ui', 'sans-serif'],   // UI / eyebrows / buttons → Hanken
        sans:        ['var(--font-hanken-grotesk)', tokens.font.body, 'system-ui', 'sans-serif'],   // was Aileron
        /* Competition print/slide materials only */
        competition:      [tokens.font.competitionDisplay, 'system-ui', 'sans-serif'], // Norwester
        'competition-body':[tokens.font.competitionBody, 'system-ui', 'sans-serif'],   // Aileron
      },
      fontSize: {
        /* V2 type scale. h1, h2 and lead are fluid (clamp, design/tokens.json);
           Tailwind's text-xs…text-5xl cover the rest. The legacy point scale
           (hero/display/title/h1/h2/h3/body/caption) is retired; nothing is set
           under 12px (scripts/ds-lint.mjs). */
        'ds-h1':      [tokens.fontSize.h1, { lineHeight: '1.05', letterSpacing: tokens.letterSpacing.display }],
        'ds-h2':      [tokens.fontSize.h2, { lineHeight: '1.1', letterSpacing: tokens.letterSpacing.heading }],
        'ds-h3':      [tokens.fontSize.h3, { lineHeight: '1.3' }],
        'ds-eyebrow': [tokens.fontSize.eyebrow, { letterSpacing: tokens.letterSpacing.eyebrow }],
        'ds-lead':    [tokens.fontSize.lead, { lineHeight: '1.5' }],
        'ds-body':    [tokens.fontSize.body, { lineHeight: '1.6' }],
        'ds-meta':    [tokens.fontSize.meta, { lineHeight: '1.4' }],
        /* Form fields below lg: anything smaller makes iOS Safari zoom in */
        'input':      [tokens.fontSize.input, { lineHeight: '1.5' }],
      },
      letterSpacing: {
        display: tokens.letterSpacing.display,
        heading: tokens.letterSpacing.heading,
        eyebrow: tokens.letterSpacing.eyebrow,
      },
      borderRadius: {
        /* Existing keys retained */
        'card':    '16px',
        'card-lg': '18px',
        /* V2 token radii */
        'control': tokens.radius.control,
        'ds-card': tokens.radius.card,
        'panel':   tokens.radius.panel,
        'cta':     tokens.radius.cta,
        'pill':    tokens.radius.pill,
      },
      maxWidth: {
        content: tokens.space.contentMax, // 1080px
        chrome:  tokens.space.chromeMax,  // 1240px
      },
      boxShadow: {
        /* Existing keys retained */
        'card':  '0 1px 3px rgba(10,23,51,.05)',
        'float': '0 30px 70px -20px rgba(5,21,53,.4)',
        /* V2 token shadows */
        'card-lift': tokens.shadow.cardLift,
        'featured':  tokens.shadow.featured,
        'panel':     tokens.shadow.panel,
      },
    },
  },
  /* Touch screens keep :hover after a tap (a "stuck" lifted card or a pill
     that looks selected). Tailwind 4's hover: already applies only where
     hover exists, so v3's `future.hoverOnlyWhenSupported` flag is gone. */
  plugins: [
    /* Two media variants that are not widths. They are plugin variants, not
       `screens`: a raw screen switches off Tailwind's min-[…]/max-[…]
       variants for the whole project. `short:` adds `:root` so it outranks
       sm:/md:/lg: on the same property whatever order Tailwind emits the
       variants in (a sideways phone is wider than sm). */
    plugin(({ addVariant }) => {
      /* Short screens: a phone held sideways is 340–415px tall but wide
         enough for the sm/md layouts. `short:` lets chrome and heroes shrink
         on height, which the width breakpoints can't see. */
      addVariant('short', '@media (max-height: 500px) { :root & }')
      /* Devices whose main pointer is a mouse or trackpad. Form fields drop
         to 14px only here: on touch screens (phones, iPads at any width)
         they stay at 16px so iOS doesn't zoom in on focus. */
      addVariant('mouse', '@media (pointer: fine)')
    }),
  ],
}

export default config
