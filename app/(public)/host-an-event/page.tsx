import type { Metadata } from 'next'
import { Users, Star, Globe } from 'lucide-react'
import { HostEventForm } from '@/components/forms/HostEventForm'

export const metadata: Metadata = {
  title: 'Host An Event',
  description:
    'Interested in running a live Stellr design competition at your facility? Learn about the benefits and submit your details.',
}

const benefits = [
  {
    icon: Star,
    title: 'Build STEM Credentials',
    description:
      'Establish and advertise your STEM capabilities in your local area. Hosting a Stellr event signals real commitment to the next generation of engineers.',
  },
  {
    icon: Users,
    title: 'Recruit & Retain Top Students',
    description:
      'Attract and retain passionate, high-performing students by giving them access to world-class design challenges right on your doorstep.',
  },
  {
    icon: Globe,
    title: 'Join a Global Community',
    description:
      'Contribute to and connect with a worldwide community of STEM professionals, educators, and organizations who share your values.',
  },
]

export default function HostAnEventPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-brand-blue-dark text-white py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-brand-orange font-semibold uppercase tracking-widest text-sm mb-4">
            Educate → Host An Event
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 max-w-3xl">Host An Event</h1>
          <p className="text-lg text-content-faint max-w-2xl leading-relaxed">
            Interested in running a live Stellr design competition at your facility? We partner with
            schools, universities, and companies to bring in-person STEM challenges to communities
            across the US and beyond.
          </p>
        </div>
      </section>

      {/* Benefits */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">
              Why Become an Event Host?
            </h2>
            <p className="text-brand-grey-dark max-w-xl mx-auto">
              Hosting a Stellr event is more than opening your doors — it&rsquo;s an investment in
              your community and your STEM profile.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
            {benefits.map((b) => {
              const Icon = b.icon
              return (
                <div key={b.title} className="bg-brand-grey-light rounded-xl p-6">
                  <div className="w-12 h-12 rounded-lg bg-brand-blue/10 flex items-center justify-center mb-4">
                    <Icon size={24} className="text-brand-blue" />
                  </div>
                  <h3 className="font-bold text-brand-blue-dark mb-2">{b.title}</h3>
                  <p className="text-sm text-brand-grey-dark leading-relaxed">{b.description}</p>
                </div>
              )
            })}
          </div>

          {/* Form */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            <div className="lg:col-span-2">
              <h2 className="text-2xl font-bold text-brand-blue-dark mb-2">Express Your Interest</h2>
              <p className="text-brand-grey-dark mb-8 text-sm">
                Fill in the details below and our team will be in touch within 2 business days.
              </p>
              <HostEventForm />
            </div>
            <aside className="space-y-6">
              <div className="bg-brand-grey-light rounded-xl p-6 space-y-3">
                <h3 className="font-bold text-brand-blue-dark">What happens next?</h3>
                <ol className="space-y-3 text-sm text-brand-grey-dark">
                  <li className="flex gap-3">
                    <span className="shrink-0 font-bold text-brand-blue">1.</span>
                    We review your submission and check availability for your preferred timing.
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 font-bold text-brand-blue">2.</span>
                    A Stellr team member reaches out to schedule an introductory call.
                  </li>
                  <li className="flex gap-3">
                    <span className="shrink-0 font-bold text-brand-blue">3.</span>
                    We co-design the event format, logistics, and promotion plan together.
                  </li>
                </ol>
              </div>
              <div className="bg-brand-blue-dark text-white rounded-xl p-6 space-y-2">
                <h3 className="font-bold">Questions?</h3>
                <p className="text-sm text-content-faint">
                  If you&rsquo;d prefer to talk before submitting, reach out directly at{' '}
                  <a
                    href="mailto:hello@stellreducation.org"
                    className="text-brand-orange hover:underline"
                  >
                    hello@stellreducation.org
                  </a>
                  .
                </p>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </>
  )
}
