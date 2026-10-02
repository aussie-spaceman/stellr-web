import type { Metadata } from 'next'
import Link from 'next/link'
import { SCHOOL_DATA_TERMS, SCHOOL_DATA_TERMS_EFFECTIVE, SCHOOL_DATA_TERMS_VERSION } from '@/lib/school-data-terms'

export const metadata: Metadata = {
  alternates: { canonical: '/school-data-terms' },
  title: 'School Data Terms',
  description: 'How Stellr Education uses and protects the student information schools share when they register a group.',
}

export default function SchoolDataTermsPage() {
  return (
    <div className="section-padding container-max max-w-3xl">
      <h1 className="text-4xl font-bold text-brand-blue-dark mb-8">School Data Terms</h1>
      <div className="prose prose-slate max-w-none space-y-6 text-brand-grey-dark">
        <p className="text-sm text-brand-grey-mid italic">
          Version {SCHOOL_DATA_TERMS_VERSION} &nbsp;·&nbsp; Effective {SCHOOL_DATA_TERMS_EFFECTIVE}
        </p>
        <p>
          When a teacher registers a group of students for a Stellr event, they accept these terms on
          their school&rsquo;s behalf. They set out what we do with the student information the school
          shares, and what we will never do with it. They sit alongside our{' '}
          <Link href="/privacy" className="text-brand-blue hover:underline">Privacy Policy</Link> and{' '}
          <Link href="/terms" className="text-brand-blue hover:underline">Terms of Use</Link>.
        </p>
        {SCHOOL_DATA_TERMS.map((section) => (
          <section key={section.heading}>
            <h2 className="text-xl font-bold text-brand-blue-dark">{section.heading}</h2>
            {section.paragraphs.map((p) => <p key={p.slice(0, 32)}>{p}</p>)}
          </section>
        ))}
      </div>
    </div>
  )
}
