import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight } from 'lucide-react'

export const metadata: Metadata = { title: 'Page Not Found' }

const quickLinks = [
  { label: 'Competitions', href: '/competitions', blurb: 'Real-world STEM design challenges' },
  { label: 'Upcoming Events', href: '/events', blurb: 'Find a challenge near you' },
  { label: 'Membership', href: '/membership', blurb: 'Plans for students, schools & mentors' },
  { label: 'Contact Us', href: '/contact', blurb: 'We’ll point you the right way' },
]

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-surface px-4 py-16">
      <Link href="/" aria-label="Stellr Education home">
        <Image
          src="/images/logo-horiz-tight.svg"
          alt="Stellr Education"
          width={180}
          height={48}
          priority
        />
      </Link>

      <p className="mt-10 text-sm font-semibold uppercase tracking-[0.08em] text-brand-blue">
        404 — Page not found
      </p>
      <h1 className="mt-3 text-3xl md:text-4xl font-bold text-brand-blue-dark text-center">
        This page has drifted off course.
      </h1>
      <p className="mt-4 max-w-md text-center text-brand-grey-dark">
        The page you’re looking for doesn’t exist or has moved. Here’s where most
        people are headed:
      </p>

      <div className="mt-10 grid w-full max-w-2xl grid-cols-1 sm:grid-cols-2 gap-4">
        {quickLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group flex flex-col gap-1 rounded-xl border border-line-light bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className="font-semibold text-brand-blue-dark flex items-center gap-1.5">
              {link.label}
              <ArrowRight size={14} className="text-brand-blue transition-transform group-hover:translate-x-0.5" />
            </span>
            <span className="text-sm text-brand-grey-dark">{link.blurb}</span>
          </Link>
        ))}
      </div>

      <Link href="/" className="btn-primary mt-10 px-8 py-3">
        Back to Home
      </Link>
    </div>
  )
}
