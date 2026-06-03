import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Stellr Education privacy policy.',
}

export default function PrivacyPage() {
  return (
    <div className="section-padding container-max max-w-3xl">
      <h1 className="text-4xl font-bold text-brand-navy mb-8">Privacy Policy</h1>
      <div className="prose prose-slate max-w-none space-y-6 text-brand-grey-dark">
        <p className="text-sm text-brand-grey-mid italic">
          Last updated: June 2026. This is a placeholder — to be reviewed by legal before public launch.
        </p>
        <h2 className="text-xl font-bold text-brand-navy">1. Data We Collect</h2>
        <p>We collect information you provide directly (name, email, school affiliation) and usage data through analytics tools (Google Analytics) when you visit this site.</p>
        <h2 className="text-xl font-bold text-brand-navy">2. How We Use Your Data</h2>
        <p>Data is used to manage event registrations, communicate competition updates, and improve the site. We do not sell personal data to third parties.</p>
        <h2 className="text-xl font-bold text-brand-navy">3. Minors</h2>
        <p>Stellr events serve students as young as middle school age. We collect only the minimum data necessary for participation. Parental consent is obtained during event registration for participants under 13.</p>
        <h2 className="text-xl font-bold text-brand-navy">4. Your Rights</h2>
        <p>You may request access to, correction of, or deletion of your personal data at any time by emailing contact@stellreducation.org.</p>
        <h2 className="text-xl font-bold text-brand-navy">5. Contact</h2>
        <p>Questions about this policy: <a href="mailto:contact@stellreducation.org" className="text-brand-blue hover:underline">contact@stellreducation.org</a></p>
      </div>
    </div>
  )
}
