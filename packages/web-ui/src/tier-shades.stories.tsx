import type { Meta, StoryObj } from '@storybook/nextjs'
import { TierCard } from './competition'
import {
  BracketShadeKey,
  TIER_IDS_BY_BRACKET,
  BRACKET_LABELS,
  bracketPalette,
  tierShade,
  type BracketId,
} from './tier-shades'

const meta: Meta = {
  title: 'Foundations/Tier Shading',
  parameters: { backgrounds: { value: 'surface' } },
}
export default meta

/* The bracket key + the three full ramps, with the usage rules. */
export const Guidelines: StoryObj = {
  render: () => (
    <div className="p-8 max-w-content flex flex-col gap-8">
      <div>
        <h2 className="font-display font-bold text-[22px] text-ink mb-1">Tier shading by age bracket</h2>
        <p className="text-sm text-content-secondary max-w-[640px] leading-relaxed">
          Three audiences, three hues (reusing existing brand colours — never green or gold, which mean
          “included / free” and “support / donate”). Within a bracket, each tier gets a distinct shade on a
          light→deep ramp: the free base tier is lightest, the most expensive tier is deepest.
        </p>
      </div>

      <BracketShadeKey />

      <div className="flex flex-col gap-5">
        {(Object.keys(TIER_IDS_BY_BRACKET) as BracketId[]).map((b) => {
          const pal = bracketPalette(b)
          return (
            <div key={b} className="bg-white border border-line rounded-panel p-5">
              <div className="flex items-center gap-2.5 mb-3">
                <span className="w-4 h-4 rounded" style={{ background: pal.base }} />
                <span className="font-display font-semibold text-ink">{BRACKET_LABELS[b]}</span>
              </div>
              <div className="flex flex-wrap gap-3">
                {TIER_IDS_BY_BRACKET[b].map((t) => (
                  <div key={t} className="flex flex-col items-center gap-1.5">
                    <span className="w-20 h-12 rounded-lg border border-black/[0.06]" style={{ background: tierShade(t) }} />
                    <span className="text-[11px] capitalize text-content-secondary">{t}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="bg-white border border-line rounded-panel p-5 text-sm text-content-secondary leading-relaxed max-w-[680px]">
        <p className="font-display font-semibold text-ink mb-2">Usage</p>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li><b>Bracket base</b> — the audience’s primary accent (active pill/tab, audience eyebrow, audience-card icon colour).</li>
          <li><b>Bracket tint</b> — soft fills behind that accent (icon chips, panels, selected-row washes).</li>
          <li><b>Bracket deep</b> — hover / pressed states of bracket-accented controls.</li>
          <li><b>Tier shade</b> — anything representing a specific tier: the TierCard strip, price and selected border + glow, accumulation bars, “viewing” badges, the bracket key.</li>
          <li>One hue per surface region — never mix two bracket hues in the same card or control.</li>
          <li>The light shades (teal <code>educator</code>, violet <code>alumni</code>) are accent/border colours — pair with dark ink text, don’t use them as body text on white.</li>
        </ul>
      </div>
    </div>
  ),
}

/* TierCard in select mode, rendering the shade strip, shade price and selected glow. */
export const TierCards: StoryObj = {
  render: () => (
    <div className="p-8 max-w-content flex flex-col gap-3">
      <BracketShadeKey />
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[200px]"><TierCard tier="educator" role="Everyone starts here" name="Educator" price="Free" priceNote="always" /></div>
        <div className="flex-1 min-w-[200px]"><TierCard tier="catalyst" role="Competition toolkit" name="Catalyst" price="$149" priceNote="per year" selected /></div>
        <div className="flex-1 min-w-[200px]"><TierCard tier="innovator" role="Mentoring & AI tools" name="Innovator" price="$499" priceNote="per year" /></div>
        <div className="flex-1 min-w-[200px]"><TierCard tier="trailblazer" role="For teachers who excel" name="Trailblazer" price="$999" priceNote="per year" /></div>
      </div>
    </div>
  ),
}
