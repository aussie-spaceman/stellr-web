import Link from 'next/link'
import Image from 'next/image'
import { Linkedin, Instagram, Facebook, Twitter } from 'lucide-react'
import { CookieSettingsLink } from '@/components/analytics/CookieSettingsLink'

const FOOTER_COLS = [
  {
    heading: 'Educate',
    links: [
      { label: 'Competitions', href: '/competitions' },
      { label: 'Curriculum', href: '/curriculum' },
      { label: 'Events & Campaigns', href: '/events' },
      { label: 'Host An Event', href: '/host-an-event' },
    ],
  },
  {
    heading: 'Community',
    links: [
      { label: 'Membership', href: '/membership' },
      { label: 'For Students', href: '/students' },
      { label: 'For Educators & Schools', href: '/educators' },
      { label: 'For Volunteers & Mentors', href: '/mentors' },
    ],
  },
  {
    heading: 'Academy',
    links: [
      { label: 'Training', href: '/academy#training' },
      { label: 'Mentoring', href: '/academy#mentoring' },
      { label: 'Coaching', href: '/academy#coaching' },
    ],
  },
  {
    heading: 'Network',
    links: [
      { label: 'Industry Partners', href: '/network#industry' },
      { label: 'University Partners', href: '/network#university' },
      { label: 'Corporate Partners', href: '/network#corporate' },
    ],
  },
  {
    heading: 'About',
    links: [
      { label: 'Impact', href: '/impact' },
      { label: 'Mission', href: '/about#mission' },
      { label: 'Team and Board', href: '/about#team' },
      { label: 'Contact Us', href: '/contact' },
      { label: 'Privacy Policy', href: '/privacy' },
    ],
  },
]

const socialLinks = [
  { icon: Linkedin, label: 'LinkedIn', href: 'https://www.linkedin.com/company/stellreducation/' },
  { icon: Instagram, label: 'Instagram', href: 'https://www.instagram.com/stellreducation/' },
  { icon: Facebook, label: 'Facebook', href: 'https://www.facebook.com/stellreducation' },
  { icon: Twitter, label: 'X / Twitter', href: 'https://x.com/stellreducation' },
]

function CopyrightBar() {
  return (
    <div className="border-t border-white/[0.08]">
      <div className="mx-auto max-w-chrome px-5 sm:px-8 py-5 flex flex-col sm:flex-row items-center justify-between flex-wrap gap-2.5 text-[13px] text-[#5A6490] font-sans">
        <span>
          2026 © Stellr Education&nbsp;&nbsp;|&nbsp;&nbsp;Registered 501(c)(3)&nbsp;&nbsp;|&nbsp;&nbsp;Built In Utah, Educating The Globe
        </span>
        <span className="flex items-center gap-5">
          <Link href="/privacy" className="hover:text-hero-lead transition-colors">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-hero-lead transition-colors">Terms of Use</Link>
          <CookieSettingsLink className="hover:text-hero-lead transition-colors" />
          <a href="mailto:hello@stellreducation.org" className="hover:text-hero-lead transition-colors">
            hello@stellreducation.org
          </a>
        </span>
      </div>
    </div>
  )
}

interface SiteFooterProps {
  variant?: 'full' | 'slim'
}

export function SiteFooter({ variant = 'full' }: SiteFooterProps) {
  if (variant === 'slim') {
    return (
      <footer className="bg-midnight">
        <CopyrightBar />
      </footer>
    )
  }

  return (
    <footer className="bg-midnight text-[#8B98C8]">
      {/* Blue accent bar */}
      <div className="h-[5px] bg-primary" />

      {/* Main grid.
          The column template was previously a hard-coded six columns with the
          brand column pinned at a 200px minimum, which works out to roughly
          770px of minimum width — about double a phone screen. On mobile that
          pushed three of the five link columns off the right edge and made
          every page scroll sideways. Found on a real iPhone; a 685px viewport
          is wide enough to hide it entirely, which is why tooling missed it.

          Collapses to two columns on phones and three on tablets. The desktop
          template is preserved exactly, so nothing above 1024px changes. */}
      <div className="mx-auto max-w-chrome px-5 pt-12 pb-10 sm:px-8 sm:pt-14 sm:pb-12">
        <div
          className="grid grid-cols-2 items-start gap-x-6 gap-y-10 sm:grid-cols-3 lg:gap-x-6 lg:gap-y-8 lg:[grid-template-columns:minmax(200px,1.1fr)_repeat(5,1fr)]"
        >
          {/* Brand column — full width until the link columns have room. */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <div className="inline-block mb-5 bg-white rounded-[14px] p-[18px_22px]">
              <Image
                src="/images/logo-horiz-tight.svg"
                alt="Stellr Education"
                width={120}
                height={40}
                className="h-[34px] w-auto block"
              />
            </div>

            <p className="text-[13.5px] leading-[1.65] text-[#7A88B8] mb-5 max-w-[220px] font-sans">
              The home of STEM education for school students — providing tomorrow&apos;s
              professionals with the skills, relationships, and career pathways they need.
            </p>

            <div className="flex gap-4 text-[#5A6490]">
              {socialLinks.map(({ icon: Icon, label, href }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#5A6490] inline-flex transition-colors hover:text-hero-dim"
                >
                  <Icon size={18} />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {FOOTER_COLS.map((col) => (
            <div key={col.heading}>
              <div className="font-display font-bold text-[12px] text-white uppercase tracking-[0.08em] mb-4">
                {col.heading}
              </div>
              <div className="flex flex-col gap-[11px]">
                {col.links.map((link) => (
                  <Link
                    key={link.href + link.label}
                    href={link.href}
                    className="text-[13.5px] text-[#8B98C8] no-underline leading-[1.4] transition-colors hover:text-hero-lead font-sans"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <CopyrightBar />
    </footer>
  )
}
