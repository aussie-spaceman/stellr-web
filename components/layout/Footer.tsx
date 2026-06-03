import Link from 'next/link'
import { Linkedin, Instagram, Facebook, Twitter } from 'lucide-react'
import { Logo } from './Logo'

const footerLinks = {
  Events: [
    { label: 'Upcoming Events', href: '/events' },
  ],
  Community: [
    { label: 'Why Stellr', href: '/why-stellr' },
    { label: 'Membership', href: '/membership' },
  ],
  Organisation: [
    { label: 'About', href: '/about' },
    { label: 'Our Team', href: '/about#team' },
    { label: 'News', href: '/news' },
    { label: 'Contact', href: '/contact' },
    { label: 'Donate', href: '/donate' },
  ],
  Legal: [
    { label: 'Privacy Policy', href: '/privacy' },
  ],
}

const socialLinks = [
  { icon: Linkedin, label: 'LinkedIn', href: '#' },
  { icon: Instagram, label: 'Instagram', href: '#' },
  { icon: Facebook, label: 'Facebook', href: '#' },
  { icon: Twitter, label: 'X / Twitter', href: '#' },
]

export function Footer() {
  return (
    <footer className="bg-brand-navy text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-8 lg:gap-12">
          {/* Brand column */}
          <div className="col-span-2">
            <Logo variant="light" />
            <p className="mt-4 text-sm text-gray-400 max-w-xs">
              Real-world STEM competitions connecting middle and high school students with industry professionals across the US.
            </p>
            <div className="mt-6 flex items-center gap-4">
              {socialLinks.map(({ icon: Icon, label, href }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <Icon size={20} />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([heading, links]) => (
            <div key={heading}>
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
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

        {/* Bottom bar */}
        <div className="mt-12 pt-8 border-t border-gray-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-400">
          <p>© 2026 Stellr Education. All rights reserved.</p>
          <a
            href="mailto:contact@stellreducation.org"
            className="hover:text-white transition-colors"
          >
            contact@stellreducation.org
          </a>
        </div>
      </div>
    </footer>
  )
}
