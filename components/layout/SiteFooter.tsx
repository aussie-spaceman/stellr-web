import Link from 'next/link'
import Image from 'next/image'
import { Linkedin, Instagram, Facebook, Twitter } from 'lucide-react'

const FOOTER_COLS = [
  {
    heading: 'Educate',
    links: [
      { label: 'Competitions', href: '/competitions' },
      { label: 'Curriculum Campaigns', href: '/curriculum' },
      { label: 'Events', href: '/events' },
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
      { label: 'Training', href: '/training' },
      { label: 'Mentoring', href: '/mentoring' },
      { label: 'Coaching', href: '/coaching' },
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
      { label: 'Our Team', href: '/about#team' },
      { label: 'Contact Us', href: '/contact' },
      { label: 'Privacy Policy', href: '/privacy' },
    ],
  },
]

const socialLinks = [
  { icon: Linkedin, label: 'LinkedIn', href: 'https://www.linkedin.com/company/industry-simulation-education/' },
  { icon: Instagram, label: 'Instagram', href: 'https://www.instagram.com/insimeducation/' },
  { icon: Facebook, label: 'Facebook', href: 'https://www.facebook.com/insimeducation/' },
  { icon: Twitter, label: 'X / Twitter', href: 'https://x.com/InSimEducation' },
]

function CopyrightBar() {
  return (
    <div className="border-t border-white/[0.08]">
      <div className="mx-auto max-w-chrome px-8 py-5 flex flex-col sm:flex-row items-center justify-between flex-wrap gap-2.5 text-[13px] text-[#5A6490] font-sans">
        <span>
          2026 © Stellr Education&nbsp;&nbsp;|&nbsp;&nbsp;Registered 501(c)(3)&nbsp;&nbsp;|&nbsp;&nbsp;Built In Utah, Educating The Globe
        </span>
        <span className="flex items-center gap-5">
          <Link href="/privacy" className="hover:text-hero-lead transition-colors">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-hero-lead transition-colors">Terms of Use</Link>
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

      {/* Main grid */}
      <div
        className="mx-auto max-w-chrome px-8"
        style={{ padding: '56px 32px 48px' }}
      >
        <div
          className="grid items-start"
          style={{
            gridTemplateColumns: 'minmax(200px,1.1fr) repeat(5,1fr)',
            gap: '32px 24px',
          }}
        >
          {/* Brand column */}
          <div>
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
