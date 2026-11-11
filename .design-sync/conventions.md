# Stellr Design System V2: how to build with it

**Setup.** Link `styles.css` once and load `_ds_bundle.js`; every component is on `window.StellrWebUI`. No provider or theme wrapper is needed. The bundle defines the font variables (`--font-space-grotesk`, `--font-hanken-grotesk`) when it loads, and `styles.css` ships the faces. Don't redefine them, and don't load other fonts.

**Styling idiom: Tailwind token utilities, already compiled.** Style your own layout glue with the utility classes in `_ds_bundle.css`. There is no Tailwind compiler in a design, so **a class that isn't in `_ds_bundle.css` does nothing**: grep it before you rely on it. Never write raw hex or font names. When a utility doesn't exist, use the token through `style={{ color: 'var(--color-ink)' }}` (tokens are listed in `_ds_bundle.css`).

| Use | Classes |
|---|---|
| Surfaces | `bg-midnight` (dark hero/CTA), `bg-surface`, `bg-white`, `bg-primary-soft` |
| Text | `text-ink`, `text-content-body`, `text-content-secondary`, `text-content-muted`, `text-hero-lead` (on midnight), `text-white`, `text-danger` |
| Brand | `bg-primary`, `text-primary`, `bg-primary-deep` |
| Theme colour | Space: `text-space-violet`, `text-space-violet-text`, `bg-space-violet-bg`. Environmental: `bg-enviro-green`, `text-enviro-green-text`, `bg-enviro-green-bg` |
| Pathway / support | `bg-pathway-amber`, `bg-pathway-amber-bg`, `text-brand-gold-ink` |
| Lines, radii, shadow | `border-line`, `border-line-strong`, `rounded-control`, `rounded-panel`, `rounded-pill`, `rounded-ds-card`, `shadow-featured` |
| Type | `font-display` / `font-heading` (Space Grotesk, headings), `font-sans` / `font-subheading` (Hanken Grotesk, body/UI), `text-ds-h2` |
| Layout | `max-w-content` (1080px content column), `max-w-chrome` (1240px header/footer), `container-max`, `section-padding` |

**Colour carries meaning.** Theme = space-violet or enviro-green. Pathway = primary or pathway-amber. Action = primary. Support/donate = gold. Green and gold also mean "included / free" and "support", so never use them as decoration. Norwester and Aileron (`--font-competition-display`, `--font-competition-body`) are for competition print materials only, never UI.

**Page shape.** Dark `Hero` on top, then light (`bg-white` / `bg-surface`) sections in a `max-w-content` column, closed by a `CtaBand`. Introduce sections with `SectionHeading` (`eyebrow`, or `step` + `stepClassName` for numbered steps). Use the library before your own markup: `Button` (variants `primary`, `secondary`, `energy`, `softBlue`, `softAmber`, `primaryStrong`, `secondaryStrong`, `outlineWhite` for midnight; `href` makes a link), `Badge`, `Eyebrow`, `InfoPill` (on dark only), `TierCard`, `PathwayCard`, `ThemeCard`, `StepCard`, `GuaranteeBadge`. Every form control goes inside `Field` (label, hint, error wiring); group radios and checkboxes with `Fieldset` + `Choice`. Overlays use `Dialog` or `ConfirmDialog`.

**Where the truth lives.** Read `components/<group>/<Name>/<Name>.prompt.md` and `<Name>.d.ts` before using a component. Read `_ds_bundle.css` for the exact class and token names.

```jsx
const { Hero, SectionHeading, TierCard, CtaBand, Button } = window.StellrWebUI;

<>
  <Hero breadcrumb="Educate → Competitions" title="Design Competitions"
    lead="Real professional STEM skills for high school students."
    pills={['High school students', 'Free for students to enter']} />
  <section className="bg-surface section-padding">
    <div className="max-w-content mx-auto px-4">
      <SectionHeading step="STEP 1" title="Choose how you take part" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TierCard name="Educator" price="Free" accessNote="Free with a member account" items={['NSES map', 'Worksheets']} />
        <TierCard name="Innovator" price="$500" badge="Best Value" featured inheritsFrom="Educator" items={['Marking rubric', 'Lesson plans']} />
      </div>
    </div>
  </section>
  <CtaBand title="Ready to start?" body="Register for an upcoming live event."
    actions={<Button href="/events" variant="primary">View Events</Button>} />
</>
```
