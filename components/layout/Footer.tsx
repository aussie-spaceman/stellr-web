import Link from 'next/link'
import { Linkedin, Instagram, Facebook, Youtube, Twitter } from 'lucide-react'
import { Logo } from './Logo'

const footerLinks = {
  Events: [
    { label: 'Upcoming Events', href: '/events' },
    { label: 'Competition Calendar', href: '/events#calendar' },
    { label: 'Host an Event', href: '/host-event' },
    { label: 'Results & Leaderboards', href: '/results' },
  ],
  Community: [
    { label: 'Students', href: '/community/students' },
    { label: 'Educators & Schools', href: '/community/educators' },
    { label: 'Parents & Families', href: '/community/parents' },
    { label: 'Mentors', href: '/community/mentors' },
    { label: 'Alumni', href: '/community/alumni' },
  ],
  Network: [
    { label: 'Industry Partners', href: '/network/partners' },
    { label: 'University Partners', href: '/network/universities' },
    { label: 'Sponsors', href: '/network/sponsors' },
    { label: 'Volunteer', href: '/volunteer' },
  ],
  'Get Involved': [
    { label: 'Donate', href: '/donate' },
    { label: 'Become a Mentor', href: '/volunteer#mentor' },
    { label: 'Become a Sponsor', href: '/network/sponsors' },
    { label: 'Partner With Us', href: '/network/partners' },
  ],
  About: [
    { label: 'Our Mission', href: '/about' },
    { label: 'Our Team', href: '/about#team' },
    { label: 'News', href: '/news' },
    { label: 'Contact Us', href: '/contact' },
    { label: 'Privacy Policy', href: '/privacy' },
  ],
}

const socialLinks = [
  { icon: Linkedin, label: 'LinkedIn', href: '#' },
  { icon: Instagram, label: 'Instagram', href: '#' },
  { icon: Facebook, label: 'Facebook', href: '#' },
  { icon: Youtube, label: 'YouTube', href: '#' },
  { icon: Twitter, label: 'X / Twitter', href: '#' },
]

export function Footer() {
  return (
    <footer>
      {/* ── Pre-footer: newsletter ── */}
      <div className="bg-brand-blue">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div>
              <p className="text-lg font-heading font-medium text-white">
                Join the Stellr community
              </p>
              <p className="text-sm text-blue-200 mt-1">
                Future engineers start here — get updates on events, opportunities, and more.
              </p>
            </div>
            <form className="flex gap-2 w-full sm:w-auto">
              <input
                type="email"
                placeholder="Your email address"
                className="flex-1 sm:w-64 px-4 py-2 rounded-md text-sm text-brand-blue-dark placeholder-gray-400 bg-white focus:outline-none focus:ring-2 focus:ring-brand-orange"
                required
              />
              <button
                type="submit"
                className="px-5 py-2 bg-brand-orange text-white text-sm font-heading font-medium rounded-md hover:bg-amber-500 transition-colors whitespace-nowrap"
              >
                Subscribe
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* ── Main footer ── */}
      <div className="bg-brand-blue-dark text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
          <div className="grid grid-cols-2 lg:grid-cols-7 gap-8 lg:gap-6">
            {/* Brand column */}
            <div className="col-span-2">
              <Logo variant="light" />
              <p className="mt-4 text-sm text-gray-400 max-w-xs leading-relaxed">
                The home of STEM education for school students — providing tomorrow's professionals
                with the skills, relationships, and career pathways they need.
              </p>
              <div className="mt-6 flex items-center gap-4">
                {socialLinks.map(({ icon: Icon, label, href }) => (
                  <a
                    key={label}
                    href={href}
                    aria-label={label}
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
                    <li key={link.href}>
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
            <p>© 2026 Stellr Education. A 501(c)(3) nonprofit organization.</p>
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
