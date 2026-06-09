import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Stellr Education privacy policy.',
}

export default function PrivacyPage() {
  return (
    <div className="section-padding container-max max-w-3xl">
      <h1 className="text-4xl font-bold text-brand-blue-dark mb-8">Privacy Policy</h1>
      <div className="prose prose-slate max-w-none space-y-6 text-brand-grey-dark">
        <p className="text-sm text-brand-grey-mid italic">
          Effective Date: 09 June 2026 &nbsp;·&nbsp; Last Updated: 09 June 2026
        </p>

        {/* 1. Introduction */}
        <h2 className="text-xl font-bold text-brand-blue-dark">1. Introduction</h2>
        <p>
          Stellr Education (&ldquo;Stellr,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates STEM competitions and an online
          community for high school students. We are committed to protecting the privacy of all
          participants, including minors. This Privacy Policy explains what personal information we
          collect, how we use and protect it, and your rights regarding that information.
        </p>
        <p>
          By registering for a Stellr competition or creating an account on our platform, you (and,
          where applicable, your parent or guardian) agree to the practices described in this Policy.
        </p>
        <p>
          <strong>This Privacy Policy applies to:</strong> our website, competition registration
          portals, and online community platform (collectively, the &ldquo;Services&rdquo;).
        </p>

        {/* 2. Minors & COPPA */}
        <h2 className="text-xl font-bold text-brand-blue-dark">2. A Note About Minors and COPPA</h2>
        <p>
          Our Services are directed to school students, many of whom are under the age of 18, and
          some of whom may be under the age of 13. We comply with the{' '}
          <strong>Children&rsquo;s Online Privacy Protection Act (COPPA)</strong>.
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Users under 13:</strong> We do not knowingly collect personal information from
            children under 13 without <strong>verifiable parental consent</strong>. If we discover
            we have collected such information without consent, we will delete it promptly. Parents
            or guardians may contact us at{' '}
            <a href="mailto:privacy@stellreducation.org" className="text-brand-blue hover:underline">
              privacy@stellreducation.org
            </a>{' '}
            to review, correct, or request deletion of their child&rsquo;s information.
          </li>
          <li>
            <strong>Users aged 13–17:</strong> We encourage parents and guardians to review this
            Policy and discuss it with their child. Certain data (such as medical and dietary
            information) may require explicit parental consent regardless of age.
          </li>
          <li>
            <strong>School-facilitated registrations:</strong> When a school or teacher registers
            students on their behalf, we rely on that school or educator to have obtained appropriate
            parental authorisation in accordance with applicable law, including COPPA and the Family
            Educational Rights and Privacy Act (FERPA).
          </li>
        </ul>

        {/* 3. Information We Collect */}
        <h2 className="text-xl font-bold text-brand-blue-dark">3. Information We Collect</h2>
        <p>We collect the following categories of personal information:</p>

        <h3 className="text-lg font-semibold text-brand-blue-dark">3.1 Identity and Contact Information</h3>
        <ul className="list-disc pl-6 space-y-1">
          <li>Full name</li>
          <li>Email address</li>
          <li>Phone number</li>
          <li>Mailing address (where required for in-person events or prize delivery)</li>
          <li>Discord &lsquo;handle&rsquo; (i.e. username)</li>
        </ul>

        <h3 className="text-lg font-semibold text-brand-blue-dark">3.2 Academic and School Information</h3>
        <ul className="list-disc pl-6 space-y-1">
          <li>School name and address</li>
          <li>Year level / grade</li>
          <li>Teacher or faculty sponsor name and contact details</li>
          <li>Team or group affiliations</li>
        </ul>

        <h3 className="text-lg font-semibold text-brand-blue-dark">3.3 Account and Login Credentials</h3>
        <ul className="list-disc pl-6 space-y-1">
          <li>Username</li>
          <li>Encrypted password</li>
          <li>Account preferences and settings</li>
          <li>Login activity and session data</li>
        </ul>

        <h3 className="text-lg font-semibold text-brand-blue-dark">3.4 Age and Date of Birth</h3>
        <ul className="list-disc pl-6 space-y-1">
          <li>Date of birth or age range (used for age-group eligibility verification and COPPA compliance)</li>
        </ul>

        <h3 className="text-lg font-semibold text-brand-blue-dark">3.5 Health and Medical Information</h3>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            Medical conditions, allergies, or requirements disclosed for in-person event safety
            purposes (e.g., EpiPen requirements, chronic conditions requiring accommodation)
          </li>
          <li>
            This is <strong>sensitive personal information</strong> and is collected only when
            necessary for participant safety
          </li>
        </ul>

        <h3 className="text-lg font-semibold text-brand-blue-dark">3.6 Dietary Requirements</h3>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            Dietary restrictions or preferences disclosed for catered in-person events (e.g.,
            vegetarian, vegan, halal, kosher, nut allergy)
          </li>
        </ul>

        <h3 className="text-lg font-semibold text-brand-blue-dark">3.7 Billing and Payment Information</h3>
        <ul className="list-disc pl-6 space-y-1">
          <li>Competition registration fees: name on card, billing address, and last four digits of payment method</li>
          <li>Transaction history and payment status</li>
          <li>
            <strong>Full payment card numbers are never stored by Stellr</strong> — payments are
            processed by Stripe, our third-party payment processor(s)
          </li>
        </ul>

        <h3 className="text-lg font-semibold text-brand-blue-dark">3.8 Photos and Videos</h3>
        <ul className="list-disc pl-6 space-y-1">
          <li>Competition event photographs and recordings in which you may appear</li>
          <li>Profile photographs uploaded to your account</li>
          <li>Submitted project videos or presentations</li>
        </ul>

        <h3 className="text-lg font-semibold text-brand-blue-dark">3.9 Technical and Usage Data</h3>
        <ul className="list-disc pl-6 space-y-1">
          <li>IP address, browser type, and device information</li>
          <li>Pages visited and features used within our platform</li>
          <li>Cookies and similar tracking technologies (see Section 9)</li>
        </ul>

        {/* 4. How We Collect */}
        <h2 className="text-xl font-bold text-brand-blue-dark">4. How We Collect Information</h2>
        <p>We collect personal information in the following ways:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li><strong>Directly from you</strong> when you register, create an account, complete forms, or communicate with us</li>
          <li><strong>From parents or guardians</strong> providing consent or registering on behalf of a minor</li>
          <li><strong>From schools and educators</strong> facilitating group registrations</li>
          <li><strong>Automatically</strong> through cookies and analytics tools when you use our platform</li>
          <li><strong>From payment processors</strong> who provide transaction confirmation data</li>
        </ul>

        {/* 5. How We Use */}
        <h2 className="text-xl font-bold text-brand-blue-dark">5. How We Use Your Information</h2>
        <p>We use collected information for the following purposes:</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse border border-gray-200">
            <thead>
              <tr className="bg-gray-50">
                <th className="border border-gray-200 px-4 py-2 text-left font-semibold">Purpose</th>
                <th className="border border-gray-200 px-4 py-2 text-left font-semibold">Data Used</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Registering and managing competition participation', 'Identity, school, age, account data'],
                ['Verifying age eligibility', 'Date of birth / age'],
                ['Providing access to the online community', 'Account / login credentials'],
                ['Communicating with participants about competitions and results', 'Contact information'],
                ['Ensuring participant safety at in-person events', 'Medical and dietary requirements'],
                ['Processing registration payments and refunds', 'Billing history'],
                ['Publishing competition results, photos, and highlights', 'Photos, videos, name'],
                ['Improving our Services through analytics', 'Technical and usage data'],
                ['Complying with legal obligations', 'All categories as required'],
                ['Responding to enquiries and support requests', 'Contact information'],
              ].map(([purpose, data]) => (
                <tr key={purpose} className="even:bg-gray-50">
                  <td className="border border-gray-200 px-4 py-2">{purpose}</td>
                  <td className="border border-gray-200 px-4 py-2">{data}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          We do <strong>not</strong> use your information for targeted advertising, sell it to third
          parties, or use it in automated decision-making that produces legal or similarly significant
          effects.
        </p>

        {/* 6. Legal Basis */}
        <h2 className="text-xl font-bold text-brand-blue-dark">6. Legal Basis for Processing</h2>
        <p>We process personal information on the following legal grounds:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li><strong>Consent</strong> — for sensitive data (medical, dietary) and for users under 13 (parental consent)</li>
          <li><strong>Contract performance</strong> — to fulfil competition registration and service agreements</li>
          <li><strong>Legitimate interests</strong> — for platform improvement, security, and fraud prevention, where these do not override your rights</li>
          <li><strong>Legal obligation</strong> — to comply with applicable laws including COPPA and FERPA</li>
        </ul>

        {/* 7. Sharing */}
        <h2 className="text-xl font-bold text-brand-blue-dark">7. Sharing Your Information</h2>
        <p>We do not sell, rent, or trade your personal information. We may share information only in the following circumstances:</p>

        <h3 className="text-lg font-semibold text-brand-blue-dark">7.1 Service Providers</h3>
        <p>We engage trusted third-party vendors to assist in delivering our Services, including:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Payment processors (e.g., for registration fees)</li>
          <li>Cloud hosting and database providers</li>
          <li>Email communication platforms</li>
          <li>Event management tools</li>
        </ul>
        <p>These providers are contractually required to handle your data securely and only as directed by us.</p>

        <h3 className="text-lg font-semibold text-brand-blue-dark">7.2 Schools and Educators</h3>
        <p>
          With the school or teacher who registered a student, limited to information relevant to
          competition participation (e.g., registration status, results).
        </p>

        <h3 className="text-lg font-semibold text-brand-blue-dark">7.3 Competition Partners and Sponsors</h3>
        <p>
          Competition results, participant names, and school affiliations may be shared with
          co-organising institutions or sponsors where you have been notified and consented at
          registration.
        </p>

        <h3 className="text-lg font-semibold text-brand-blue-dark">7.4 Public Recognition</h3>
        <p>
          Unless you opt out, competition results, names, school affiliations, and photographs may
          be published on our website, social media channels, or press releases. We will seek
          explicit consent before publishing identifiable photographs of minors.
        </p>

        <h3 className="text-lg font-semibold text-brand-blue-dark">7.5 Legal Requirements</h3>
        <p>
          We may disclose information when required by law, court order, or to protect the safety
          of participants or the public.
        </p>

        <h3 className="text-lg font-semibold text-brand-blue-dark">7.6 Business Transfers</h3>
        <p>
          In the event of a merger, acquisition, or transfer of assets, personal information may be
          transferred to a successor organisation, subject to the same privacy protections described
          here.
        </p>

        {/* 8. Sensitive Information */}
        <h2 className="text-xl font-bold text-brand-blue-dark">8. Sensitive Information</h2>
        <p>We treat the following categories as <strong>sensitive</strong> and apply heightened protections:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li><strong>Medical and health information</strong> — collected solely for participant safety; accessible only to staff with a direct need; never shared with sponsors, partners, or the public; deleted promptly after the relevant event</li>
          <li><strong>Dietary requirements</strong> — used only for event catering logistics; not retained beyond the event</li>
          <li><strong>Date of birth</strong> — used for eligibility and COPPA compliance; not displayed publicly</li>
          <li><strong>Payment data</strong> — handled exclusively by our payment processor Stripe; Stellr retains only transaction confirmations and last-four-digit references</li>
        </ul>

        {/* 9. Cookies */}
        <h2 className="text-xl font-bold text-brand-blue-dark">9. Cookies and Tracking Technologies</h2>
        <p>We use cookies and similar technologies to:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Keep you logged in to your account</li>
          <li>Remember your preferences</li>
          <li>Collect aggregate analytics on how our platform is used</li>
        </ul>
        <p>
          We do <strong>not</strong> use advertising cookies or cross-site tracking cookies. You may
          control cookie settings through your browser. Disabling certain cookies may affect platform
          functionality.
        </p>

        {/* 10. Data Retention */}
        <h2 className="text-xl font-bold text-brand-blue-dark">10. Data Retention</h2>
        <p>We retain personal information only as long as necessary:</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse border border-gray-200">
            <thead>
              <tr className="bg-gray-50">
                <th className="border border-gray-200 px-4 py-2 text-left font-semibold">Data Type</th>
                <th className="border border-gray-200 px-4 py-2 text-left font-semibold">Retention Period</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Account and competition records', 'Duration of account'],
                ['Medical and dietary information', 'Duration of account'],
                ['Payment transaction records', '7 years (US tax/accounting requirements)'],
                ['Photos and videos', 'Until you request removal, or indefinitely'],
                ['Technical/usage logs', 'Generally 12 months, with minor exceptions on a platform-specific basis'],
              ].map(([type, period]) => (
                <tr key={type} className="even:bg-gray-50">
                  <td className="border border-gray-200 px-4 py-2">{type}</td>
                  <td className="border border-gray-200 px-4 py-2">{period}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>You may request earlier deletion subject to Section 12.</p>

        {/* 11. Data Security */}
        <h2 className="text-xl font-bold text-brand-blue-dark">11. Data Security</h2>
        <p>
          We implement reasonable administrative, technical, and physical safeguards to protect your
          information, including:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Encryption of passwords and sensitive data at rest and in transit (TLS/SSL)</li>
          <li>Restricted staff access on a need-to-know basis</li>
          <li>Regular security reviews of our platform</li>
          <li>Prompt notification to affected users in the event of a data breach, as required by applicable law</li>
        </ul>
        <p>
          No system is completely secure. If you believe your account has been compromised, contact
          us immediately at{' '}
          <a href="mailto:privacy@stellreducation.org" className="text-brand-blue hover:underline">
            privacy@stellreducation.org
          </a>
          .
        </p>

        {/* 12. Your Rights */}
        <h2 className="text-xl font-bold text-brand-blue-dark">12. Your Rights</h2>

        <h3 className="text-lg font-semibold text-brand-blue-dark">All Users</h3>
        <ul className="list-disc pl-6 space-y-2">
          <li><strong>Access</strong> — request a copy of personal information we hold about you</li>
          <li><strong>Correction</strong> — request correction of inaccurate information</li>
          <li><strong>Deletion</strong> — request deletion of your information (subject to legal retention requirements)</li>
          <li><strong>Withdrawal of consent</strong> — withdraw consent for processing based on consent (e.g., for publication of photos)</li>
          <li><strong>Opt-out of communications</strong> — unsubscribe from non-essential emails at any time</li>
        </ul>

        <h3 className="text-lg font-semibold text-brand-blue-dark">Parents and Guardians (COPPA Rights)</h3>
        <ul className="list-disc pl-6 space-y-2">
          <li>Review personal information collected from your child under 13</li>
          <li>Request correction or deletion of that information</li>
          <li>Refuse further collection or use of your child&rsquo;s information</li>
          <li>
            Contact us at any time:{' '}
            <a href="mailto:privacy@stellreducation.org" className="text-brand-blue hover:underline">
              privacy@stellreducation.org
            </a>
          </li>
        </ul>

        <h3 className="text-lg font-semibold text-brand-blue-dark">California Residents (CCPA/CPRA)</h3>
        <p>California residents have additional rights under the California Consumer Privacy Act:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Right to know what personal information is collected, used, shared, or sold</li>
          <li>Right to delete personal information</li>
          <li>Right to opt out of the sale or sharing of personal information (<strong>we do not sell personal information</strong>)</li>
          <li>Right to non-discrimination for exercising your privacy rights</li>
          <li>Right to correct inaccurate personal information</li>
          <li>Right to limit use of sensitive personal information</li>
        </ul>
        <p>
          To exercise any of these rights, contact{' '}
          <a href="mailto:privacy@stellreducation.org" className="text-brand-blue hover:underline">
            privacy@stellreducation.org
          </a>
          . We will respond within 45 days.
        </p>

        {/* 13. Third-Party Links */}
        <h2 className="text-xl font-bold text-brand-blue-dark">13. Third-Party Links</h2>
        <p>
          Our platform may contain links to third-party websites or resources (e.g., partner
          organisations, competition hosts). We are not responsible for the privacy practices of
          those sites and encourage you to review their policies independently.
        </p>

        {/* 14. Changes */}
        <h2 className="text-xl font-bold text-brand-blue-dark">14. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. When we do, we will post the revised
          version on our website with an updated &ldquo;Last Updated&rdquo; date. For material changes, we will
          provide notice via email or a prominent platform notification. Continued use of our
          Services after notice constitutes acceptance of the updated Policy.
        </p>

        {/* 15. Contact */}
        <h2 className="text-xl font-bold text-brand-blue-dark">15. Contact Us</h2>
        <p>For questions, concerns, or to exercise your privacy rights, please contact:</p>
        <p>
          <strong>Stellr Education — Privacy Team</strong>
          <br />
          Email:{' '}
          <a href="mailto:privacy@stellreducation.org" className="text-brand-blue hover:underline">
            privacy@stellreducation.org
          </a>
        </p>
        <p>
          For urgent concerns involving a minor&rsquo;s data, please mark your email{' '}
          <strong>URGENT: Minor Data</strong>.
        </p>
      </div>
    </div>
  )
}
