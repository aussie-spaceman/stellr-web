import type { Metadata } from 'next'
import { Mail, MapPin, Phone } from 'lucide-react'
import { Hero } from '@stellr/web-ui'
import { ContactForm } from '@/components/forms/ContactForm'
import { BookCallButton } from '@/components/sections/BookCallButton'

export const metadata: Metadata = {
  alternates: { canonical: '/contact' },
  title: 'Contact',
  description: 'Get in touch with the Stellr Education team.',
}

// Static: the `?type=` deep link is read by ContactForm in the browser.
export default function ContactPage() {

  return (
    <>
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <Hero
        breadcrumb="About → Contact"
        title="Get in Touch"
        lead="Questions about events, sponsorship, mentoring, or anything else — we’d love to hear from you."
      />

      {/* ── Content ──────────────────────────────────────────────────── */}
      <section className="section-padding">
        <div className="container-max">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

            {/* Form */}
            <div className="lg:col-span-2">
              <ContactForm />
            </div>

            {/* Sidebar */}
            <aside className="space-y-6">
              <div className="rounded-ds-card border border-line bg-white p-6 shadow-card">
                <h2 className="font-bold text-ink text-lg">Prefer to talk?</h2>
                <p className="mt-1.5 text-sm text-content-secondary">
                  Book 15 minutes with our team — for parents, educators and partners.
                </p>
                <BookCallButton location="contact_sidebar" className="mt-4 w-full" />
              </div>

              <div className="bg-brand-grey-light rounded-xl p-6 space-y-4">
                <h2 className="font-bold text-brand-blue-dark text-lg">Contact Details</h2>

                <div className="flex items-start gap-3">
                  <Mail size={18} className="text-brand-blue mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-brand-blue-dark">Email</p>
                    <a
                      href="mailto:hello@stellreducation.org"
                      className="text-sm text-brand-blue underline underline-offset-2 hover:no-underline"
                    >
                      hello@stellreducation.org
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Phone size={18} className="text-brand-blue mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-brand-blue-dark">Phone</p>
                    <a href="tel:+18018105848" className="text-sm text-brand-blue underline underline-offset-2 hover:no-underline">
                      +1 (801) 810-5848
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <MapPin size={18} className="text-brand-blue mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-brand-blue-dark">Based in</p>
                    <p className="text-sm text-brand-grey-dark">Salt Lake City, Utah</p>
                  </div>
                </div>
              </div>

              <div className="bg-brand-blue-dark text-white rounded-xl p-6 space-y-3">
                <h2 className="font-bold text-lg">Response time</h2>
                <p className="text-sm text-hero-lead">
                  We aim to respond to all inquiries within 2 business days.
                </p>
                <p className="text-sm text-hero-lead">
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
                  className="text-sm font-semibold text-brand-blue underline underline-offset-2 hover:no-underline"
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
