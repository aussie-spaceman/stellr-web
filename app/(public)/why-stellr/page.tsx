import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Why Stellr?',
  description: 'Find out what Stellr means for you — students, teachers, parents, mentors, and donors.',
}

export default function WhyStelrPage() {
  return (
    <div className="section-padding container-max">
      <h1 className="text-4xl font-bold text-brand-navy">Why Stellr?</h1>
      <p className="mt-3 text-brand-grey-dark">Role-specific sections — coming in step 8.</p>
    </div>
  )
}
