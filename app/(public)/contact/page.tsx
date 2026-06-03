import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Get in touch with the Stellr Education team.',
}

export default function ContactPage() {
  return (
    <div className="section-padding container-max">
      <h1 className="text-4xl font-bold text-brand-navy">Contact Us</h1>
      <p className="mt-3 text-brand-grey-dark">Contact form — coming in step 12.</p>
    </div>
  )
}
