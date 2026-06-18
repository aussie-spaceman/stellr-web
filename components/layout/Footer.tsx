import Link from 'next/link'
import { Linkedin, Instagram, Facebook, Twitter } from 'lucide-react'
import { Logo } from './Logo'
import { SubscribeForm } from '@/components/forms/SubscribeForm'

const footerLinks = {
  Educate: [
    { label: 'Competitions', href: '/competitions' },
    { label: 'Activities', href: '/activities' },
    { label: 'Events', href: '/events' },
    { label: 'Host An Event', href: '/host-an-event' },
  ],
  Community: [
    { label: 'Membership', href: '/membership' },
    { label: 'For Students', href: '/students' },
    { label: 'For Educators & Schools', href: '/educators' },
    { label: 'For Volunteers & Mentors', href: '/mentors' },
  ],
  Academy: [
    { label: 'Training', href: '/training' },
    { label: 'Mentoring', href: '/mentoring' },
    { label: 'Coaching', href: '/coaching' },
  ],
  Network: [
    { label: 'Industry Partners', href: '/network#industry' },
    { label: 'University Partners', href: '/network#university' },
    { label: 'Corporate Partners', href: '/network#corporate' },
  ],
  About: [
    { label: 'Impact', href: '/impact' },
    { label: 'Mission', href: '/about#mission' },
    { label: 'Our Team', href: '/about#team' },
    { label: 'Contact Us', href: '/contact' },
    { label: 'Privacy Policy', href: '/privacy' },
  ],
}

const socialLinks = [
  { icon: Linkedin, label: 'LinkedIn', href: 'https://www.linkedin.com/company/industry-simulation-education/' },
  { icon: Instagram, label: 'Instagram', href: 'https://www.instagram.com/insimeducation/' },
  { icon: Facebook, label: 'Facebook', href: 'https://www.facebook.com/insimeducation/' },
  { icon: Twitter, label: 'X / Twitter', href: 'https://x.com/InSimEducation' },
]

export function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer>
      {/* ── Pre-footer: newsletter ── */}
      <div className="bg-brand-blue">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="max-w-xl">
              <p className="text-lg font-heading font-medium text-white">
                Stay In The Loop
              </p>
              <p className="text-sm text-blue-200 mt-1">
                The home of future STEM professionals — get updates on competitions, curriculum
                resources, and professional opportunities, straight to your inbox.
              </p>
            </div>
            <div className="w-full sm:w-auto sm:min-w-80">
              <SubscribeForm />
              <p className="mt-2 text-xs text-blue-200/80">Unsubscribe at any time.</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main footer ── */}
      <div className="bg-brand-blue-dark text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
          <div className="grid grid-cols-2 lg:grid-cols-7 gap-8 lg:gap-6">
            {/* Brand column */}
            <div className="col-span-2">
              <Logo variant="light" withTagline sizeClassName="h-44" />
              <p className="mt-4 text-sm text-gray-400 max-w-xs leading-relaxed">
                The home of STEM education for school students — providing tomorrow&apos;s
                professionals with the skills, relationships, and career pathways they need.
              </p>
              <div className="mt-6 flex items-center gap-4">
                {socialLinks.map(({ icon: Icon, label, href }) => (
                  <a
                    key={label}
                    href={href}
                    aria-label={label}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-500 hover:text-white transition-colors"
                  >
                    <Icon size={18} />
                  </a>
                ))}
              </div>
            </div>

            {/* Link columns */}
            {Object.entries(footerLinks).map(([heading, links]) => (
              <div key={heading}>
                <h3 className="text-xs font-heading font-semibold text-white uppercase tracking-wider">
                  {heading}
                </h3>
                <ul className="mt-4 space-y-2">
                  {links.map((link) => (
                    <li key={link.href + link.label}>
                      <Link
                        href={link.href}
                        className="text-sm text-gray-400 hover:text-white transition-colors"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* ── Bottom bar ── */}
          <div className="mt-12 pt-8 border-t border-gray-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500">
            <p>{year} © Stellr Education&nbsp;&nbsp;|&nbsp;&nbsp;Registered 501(c)(3)&nbsp;&nbsp;|&nbsp;&nbsp;Built In Utah, Educating The Globe</p>
            <div className="flex items-center gap-4">
              <Link href="/privacy" className="hover:text-white transition-colors">
                Privacy Policy
              </Link>
              <Link href="/terms" className="hover:text-white transition-colors">
                Terms of Use
              </Link>
              <a
                href="mailto:hello@stellreducation.org"
                className="hover:text-white transition-colors"
              >
                hello@stellreducation.org
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
