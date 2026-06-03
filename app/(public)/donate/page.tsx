import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Donate',
  description: 'Support the next generation of STEM leaders.',
}

export default function DonatePage() {
  return (
    <div className="section-padding container-max">
      <h1 className="text-4xl font-bold text-brand-navy">Support the next generation of STEM leaders</h1>
      <p className="mt-3 text-brand-grey-dark">Donation page — coming in step 13.</p>
    </div>
  )
}
