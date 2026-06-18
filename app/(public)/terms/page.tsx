import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: 'Stellr Education terms of use.',
}

export default function TermsPage() {
  return (
    <div className="section-padding container-max max-w-3xl">
      <h1 className="text-4xl font-bold text-brand-blue-dark mb-8">Terms of Use</h1>
      <div className="prose prose-slate max-w-none space-y-6 text-brand-grey-dark">
        <p className="text-sm text-brand-grey-mid italic">
          Last Updated: {new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' })}
        </p>
        <p className="text-sm bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-brand-blue-dark">
          <strong>Draft:</strong> These Terms of Use are being finalized. The summary below describes
          the terms that govern use of our Services in the interim. For any questions, contact{' '}
          <a href="mailto:hello@stellreducation.org" className="text-brand-blue hover:underline">
            hello@stellreducation.org
          </a>
          .
        </p>

        {/* 1. Acceptance */}
        <h2 className="text-xl font-bold text-brand-blue-dark">1. Acceptance of These Terms</h2>
        <p>
          Stellr Education (&ldquo;Stellr,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
          &ldquo;our&rdquo;) is a 501(c)(3) nonprofit organization that operates STEM competitions
          and an online community for school students. By accessing or using our website,
          competition registration portals, and online community platform (collectively, the
          &ldquo;Services&rdquo;), you agree to these Terms of Use. If you do not agree, please do
          not use the Services.
        </p>

        {/* 2. Eligibility & accounts */}
        <h2 className="text-xl font-bold text-brand-blue-dark">2. Eligibility and Accounts</h2>
        <p>
          Many of our participants are minors. Where a participant is under 18, registration and use
          of the Services requires the involvement and consent of a parent, legal guardian, or
          authorized school official. You are responsible for keeping your account credentials
          secure and for all activity that occurs under your account.
        </p>

        {/* 3. Acceptable use */}
        <h2 className="text-xl font-bold text-brand-blue-dark">3. Acceptable Use</h2>
        <p>
          You agree to use the Services lawfully and respectfully. You may not misuse the Services,
          attempt to disrupt them, infringe the rights of others, or use them to harass, harm, or
          impersonate any person, including within our community spaces.
        </p>

        {/* 4. Intellectual property */}
        <h2 className="text-xl font-bold text-brand-blue-dark">4. Intellectual Property</h2>
        <p>
          Content and curriculum materials provided through the Services are owned by Stellr or its
          licensors and are made available for educational, non-commercial use in connection with
          Stellr programs unless otherwise stated.
        </p>

        {/* 5. Privacy */}
        <h2 className="text-xl font-bold text-brand-blue-dark">5. Privacy</h2>
        <p>
          Your use of the Services is also governed by our{' '}
          <Link href="/privacy" className="text-brand-blue hover:underline">
            Privacy Policy
          </Link>
          , which explains how we collect, use, and protect personal information, including that of
          minors.
        </p>

        {/* 6. Disclaimers */}
        <h2 className="text-xl font-bold text-brand-blue-dark">6. Disclaimers and Changes</h2>
        <p>
          The Services are provided on an &ldquo;as is&rdquo; basis. We may update these Terms from
          time to time; material changes will be reflected by the &ldquo;Last Updated&rdquo; date
          above. Continued use of the Services after changes take effect constitutes acceptance of
          the revised Terms.
        </p>

        {/* 7. Contact */}
        <h2 className="text-xl font-bold text-brand-blue-dark">7. Contact</h2>
        <p>
          Questions about these Terms can be sent to{' '}
          <a href="mailto:hello@stellreducation.org" className="text-brand-blue hover:underline">
            hello@stellreducation.org
          </a>
          .
        </p>
      </div>
    </div>
  )
}
