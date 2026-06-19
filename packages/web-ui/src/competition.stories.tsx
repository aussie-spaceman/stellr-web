import type { Meta, StoryObj } from '@storybook/nextjs'
import { Launch, Environment } from '@stellr/icons'
import { StepCard, PathwayCard, ThemeCard, TierCard, ProgressionGraphic } from './competition'

const meta: Meta = { title: 'Competition', parameters: { backgrounds: { value: 'surface' } } }
export default meta

export const Steps: StoryObj = {
  render: () => (
    <div className="p-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 max-w-content">
      <StepCard n={1} title="Get the brief" body="A themed RFP sets a real engineering challenge." />
      <StepCard n={2} title="Form a team" body="Students work together like a professional firm." />
      <StepCard n={3} title="Design & decide" body="Research, prototype, weigh trade-offs, run the numbers." />
      <StepCard n={4} title="Build the deliverable" body="A written proposal or a presentation of the solution." />
      <StepCard n={5} title="Pitch & be judged" body="Present to judges; strong teams progress to finals." />
    </div>
  ),
}

export const Pathways: StoryObj = {
  render: () => (
    <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-content">
      <PathwayCard
        eyebrow="Pathway 1"
        name="Live Event"
        tagline="A competition run by Stellr"
        headerClass="bg-gradient-to-br from-primary to-primary-deep"
        rows={[['Who runs it', 'Stellr staff'], ['Where', 'In-person or virtual'], ['How long', 'Fixed dates']]}
        cta={{ label: 'Browse upcoming events', href: '/events', className: 'bg-primary-soft text-primary hover:bg-primary/15' }}
      />
      <PathwayCard
        eyebrow="Pathway 2"
        name="Curriculum Campaign"
        tagline="You run it in class, from our curriculum"
        headerClass="bg-gradient-to-br from-pathway-amber to-[#C2722A]"
        rows={[['Who runs it', 'You, the educator'], ['Where', 'Your school or classroom'], ['How long', 'Flexible — you set the pace']]}
        cta={{ label: 'Download curriculum', href: '/activities', className: 'bg-pathway-amber-bg text-brand-gold-ink hover:bg-pathway-amber/15' }}
      />
    </div>
  ),
}

export const Themes: StoryObj = {
  render: () => (
    <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-content">
      <ThemeCard
        name="Space"
        Icon={Launch}
        iconBg="bg-space-violet"
        accent="text-space-violet-text"
        border="border-space-violet-chip"
        headerBg="bg-gradient-to-b from-space-violet-bg to-white"
        briefBg="bg-space-violet-bg"
        blurb="Engineering inspired by space exploration — the systems that keep a mission alive and on course."
        explore={['Propulsion & trajectory', 'Life support', 'Radiation shielding', 'Power & storage', 'Comms', 'Mass & cost budgets']}
        brief="Design a lunar-surface habitat that keeps a four-person crew alive for 90 days."
      />
      <ThemeCard
        name="Environmental"
        Icon={Environment}
        iconBg="bg-enviro-green"
        accent="text-enviro-green-text"
        border="border-enviro-green-chip"
        headerBg="bg-gradient-to-b from-enviro-green-bg to-white"
        briefBg="bg-enviro-green-bg"
        blurb="Real-world environmental problems solved through systems thinking and honest trade-offs."
        explore={['Renewable energy', 'Water & waste', 'Emissions modelling', 'Cost vs impact', 'Climate constraints', 'Payback']}
        brief="Design a net-zero energy system for a town of 5,000 with a 10-year payback target."
      />
    </div>
  ),
}

export const Tiers: StoryObj = {
  render: () => (
    <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start max-w-content">
      <TierCard name="Subscriber" price="Free" accessNote="Publicly available" items={['RFP', 'Mission Handbook', 'Past work']} />
      <TierCard name="Educator" price="Free" accessNote="Free with a member account" inheritsFrom="Subscriber" items={['NSES map', 'Worksheets', 'Community Spaces']} />
      <TierCard name="Innovator" price="$500" accessNote="Free 1st year for participants" inheritsFrom="Educator" badge="Best Value" featured items={['Marking rubric', 'Lesson plans', 'AI sub-contractors', 'Certificates']} />
      <TierCard name="Trailblazer" price="$1,000" accessNote="Comprehensive support" inheritsFrom="Innovator" items={['Mentoring calls', 'CTE credits', 'Student awards']} />
    </div>
  ),
}

export const Progression: StoryObj = {
  render: () => (
    <div className="p-8 max-w-content">
      <ProgressionGraphic
        heading="Where it leads"
        note="More info coming soon"
        nodes={[
          { label: 'Take part', labelClass: 'text-primary', title: 'Enter a Campaign or Event' },
          { label: 'Advance', labelClass: 'text-space-violet', title: 'Top teams progress to the finals' },
          { label: 'The final', labelClass: 'text-brand-gold-ink', title: 'Annual Championship event', titleClass: 'text-brand-gold-ink', cardClass: 'bg-pathway-amber-bg border border-pathway-amber/30', star: true },
        ]}
      />
    </div>
  ),
}
