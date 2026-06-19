import type { Metadata } from 'next'
import { Mail, MapPin } from 'lucide-react'
import { ContactForm } from '@/components/forms/ContactForm'

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Get in touch with the Stellr Education team.',
}

interface PageProps {
  searchParams: Promise<{ type?: string }>
}

export default async function ContactPage({ searchParams }: PageProps) {
  const { type } = await searchParams
  const prefillType = type === 'mentor'
    ? 'Volunteer / Mentor'
    : type === 'sponsorship'
    ? 'Sponsorship / Donation'
    : undefined

  return (
    <>
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold mb-3">Get in Touch</h1>
          <p className="text-lg text-content-faint max-w-xl">
            Questions about events, sponsorship, mentoring, or anything else — we&apos;d love to hear from you.
          </p>
        </div>
      </section>

      {/* ── Content ──────────────────────────────────────────────────── */}
      <section className="section-padding">
        <div className="container-max">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

            {/* Form */}
            <div className="lg:col-span-2">
              <ContactForm prefillType={prefillType} />
            </div>

            {/* Sidebar */}
            <aside className="space-y-6">
              <div className="bg-brand-grey-light rounded-xl p-6 space-y-4">
                <h2 className="font-bold text-brand-blue-dark text-lg">Contact Details</h2>

                <div className="flex items-start gap-3">
                  <Mail size={18} className="text-brand-blue mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-brand-blue-dark">Email</p>
                    <a
                      href="mailto:hello@stellreducation.org"
                      className="text-sm text-brand-blue hover:underline"
                    >
                      hello@stellreducation.org
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <MapPin size={18} className="text-brand-blue mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-brand-blue-dark">Based in</p>
                    <p className="text-sm text-brand-grey-dark">United States</p>
                  </div>
                </div>
              </div>

              <div className="bg-brand-blue-dark text-white rounded-xl p-6 space-y-3">
                <h2 className="font-bold text-lg">Response time</h2>
                <p className="text-sm text-content-faint">
                  We aim to respond to all enquiries within 2 business days.
                </p>
                <p className="text-sm text-content-faint">
                  For urgent event-related questions, include your event name in the subject.
                </p>
              </div>

              <div className="bg-blue-50 rounded-xl p-6 border border-blue-100">
                <h2 className="font-bold text-brand-blue-dark mb-2">Interested in mentoring?</h2>
                <p className="text-sm text-brand-grey-dark mb-3">
                  Industry professionals and Stellr alumni can volunteer as mentors at upcoming events.
                </p>
                <a
                  href="?type=mentor"
                  className="text-sm font-semibold text-brand-blue hover:underline"
                >
                  Select &ldquo;Volunteer / Mentor&rdquo; in the form →
                </a>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </>
  )
}
