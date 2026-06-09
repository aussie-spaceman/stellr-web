import type { Metadata } from 'next'
import Link from 'next/link'
import { BookOpen, Users, Network, GraduationCap, ArrowRight } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Educate | Stellr Education',
  description:
    'Stellr educates the next generation of STEM professionals through competitions, curriculum activities, live events, and a global community.',
}

const components = [
  {
    label: 'Stellr.Academy',
    description: 'Training',
    icon: GraduationCap,
    href: '/academy',
  },
  {
    label: 'Stellr.Educate',
    description: 'All Activities',
    icon: BookOpen,
    href: '/activities',
  },
  {
    label: 'Stellr.Community',
    description: 'Network and Mentoring',
    icon: Users,
    href: '/community',
  },
  {
    label: 'Stellr.Network',
    description: 'Partners and other providers',
    icon: Network,
    href: '/network',
  },
]

const educateLinks = [
  {
    label: 'Competitions',
    description:
      'Live design challenges for middle and high school students across multiple themes.',
    href: '/competitions',
  },
  {
    label: 'Activities',
    description:
      'Download curriculum material and run a Campaign in your classroom, on your schedule.',
    href: '/activities',
  },
  {
    label: 'Events',
    description: 'Register for upcoming in-person and virtual STEM events near you.',
    href: '/events',
  },
  {
    label: 'Host An Event',
    description:
      'Bring a Stellr design competition to your facility and your community.',
    href: '/host-an-event',
  },
]

export default function EducatePage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-brand-blue-dark text-white py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-brand-orange font-semibold uppercase tracking-widest text-sm mb-4">
            Educate
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 max-w-3xl">
            STEM Skills for a Better Future
          </h1>
          <p className="text-lg text-gray-300 max-w-2xl leading-relaxed">
            Stellr educates the critical, so-called &ldquo;soft skills&rdquo; that the STEM fields
            desperately require — for students building careers, and for industries solving
            tomorrow&rsquo;s biggest challenges.
          </p>
        </div>
      </section>

      {/* The Challenge */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl font-bold text-brand-blue-dark mb-6">
                Technical skills alone aren&rsquo;t enough
              </h2>
              <p className="text-brand-grey-dark mb-4 leading-relaxed">
                The STEM fields face a growing gap: highly qualified engineers and scientists who
                struggle to communicate, collaborate, and lead. Industry needs better overall STEM
                Skills to solve today&rsquo;s problems and tomorrow&rsquo;s challenges.
              </p>
              <p className="text-brand-grey-dark mb-4 leading-relaxed">
                Students need these skills to succeed in their own careers — long before they enter
                the workforce.
              </p>
              <p className="text-brand-grey-dark leading-relaxed">
                We believe the best way to improve humanity is to recognize that we&rsquo;re all
                educators, and we all want to contribute to improving the opportunities of STEM
                professionals — whether they&rsquo;re in middle school, newly minted professional
                engineers, or retirees.
              </p>
            </div>
            <div className="bg-brand-grey-light rounded-2xl p-10 text-center">
              <p className="text-2xl font-bold text-brand-blue-dark leading-snug">
                &ldquo;We are the flywheel to engineering a better future.&rdquo;
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* The 4 Components */}
      <section className="section-padding bg-brand-grey-light">
        <div className="container-max">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">How We Do It</h2>
            <p className="text-brand-grey-dark max-w-xl mx-auto">
              Our education flywheel runs across four integrated components, each reinforcing the
              others.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {components.map((c) => {
              const Icon = c.icon
              return (
                <Link
                  key={c.href}
                  href={c.href}
                  className="bg-white rounded-xl p-6 flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow group"
                >
                  <div className="w-12 h-12 rounded-lg bg-brand-blue/10 flex items-center justify-center">
                    <Icon size={24} className="text-brand-blue" />
                  </div>
                  <div>
                    <p className="font-bold text-brand-blue-dark group-hover:text-brand-blue transition-colors">
                      {c.label}
                    </p>
                    <p className="text-sm text-brand-grey-dark mt-1">{c.description}</p>
                  </div>
                  <ArrowRight size={16} className="text-brand-blue mt-auto" />
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      {/* Sub-section cards */}
      <section className="section-padding bg-white">
        <div className="container-max">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-brand-blue-dark mb-4">Explore Educate</h2>
            <p className="text-brand-grey-dark max-w-xl mx-auto">
              Whether you&rsquo;re an educator looking for curriculum, a student ready to compete,
              or an organization wanting to host — there&rsquo;s a place for you.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {educateLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="border border-gray-200 rounded-xl p-8 hover:border-brand-blue hover:shadow-md transition-all group"
              >
                <h3 className="text-xl font-bold text-brand-blue-dark group-hover:text-brand-blue transition-colors mb-3">
                  {link.label}
                </h3>
                <p className="text-brand-grey-dark text-sm leading-relaxed mb-4">
                  {link.description}
                </p>
                <span className="text-brand-blue text-sm font-semibold flex items-center gap-1">
                  Learn more <ArrowRight size={14} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
