import type { Metadata } from 'next'

export const metadata: Metadata = {
  alternates: { canonical: '/privacy' },
  title: 'Privacy Policy',
  description: 'Stellr Education privacy policy.',
}

export default function PrivacyPage() {
  return (
    <div className="section-padding container-max max-w-3xl">
      <h1 className="text-4xl font-bold text-brand-blue-dark mb-8">Privacy Policy</h1>
      <div className="prose prose-slate max-w-none space-y-6 text-brand-grey-dark">
        <p className="text-sm text-brand-grey-mid italic">
          Effective Date: 09-Jun-2026 &nbsp;·&nbsp; Last Updated: 02-Oct-2026
        </p>
        <p className="text-sm bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-brand-blue-dark">
          <strong>Recent update (02-Oct-2026):</strong>{' '}Student self-registration and pending
          accounts; the definition of Minor (state age of majority); students who are adults but
          still in high school; students&rsquo; own opt-out choices; deletion within 30 days on
          request; our children&rsquo;s data retention policy; credential pages for children under
          13; FERPA protections for all student data; cookies on student pages, including for
          children under 13 (Sections 2, 3.10, 5, 7.1, 7.4, 7.7, 8, 9, 10, 12, 14). Consent forms
          and agreements can also now be signed through <strong>Stellr&rsquo;s own signing
          system</strong> as well as DocuSign (Sections 2, 3.10, 4, 5 and 7.1): when you sign, we
          record your name, email, the date and time, and the internet address and browser you
          used. Medical information is deleted within 90 days after the event, and dietary details
          are kept on your member record for future events (Section 8); the photo and media
          permission on the consent form is an opt-out (Section 7.4); we list every provider we
          use, including Google Workspace, Checkr, Printful and Discord (Section 7.1); and school
          registrations are covered by our new{' '}
          <a href="/school-data-terms" className="underline">School Data Terms</a> (Section 7.7).
        </p>
        <p className="text-sm bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-brand-blue-dark">
          <strong>Earlier update (23 Sep 2026):</strong> We now describe{' '}
          <strong>credentials and LinkedIn sharing</strong> in full (Sections 3.11, 5, 7.4, 10, 12
          and 13): what a credential page shows, that it is private until you choose to make it
          public, how a parent or guardian can say no for a student under 18, and that once you
          share a credential on LinkedIn, Stellr cannot control what LinkedIn does with it. Section
          14 now explains that we announce changes to this policy here, on our website, rather than
          by email. The 21 Sep 2026 update first introduced credential pages in Section 7.4. The 17
          Aug 2026 update covered Sections 3, 5, 7 and 9 to
          describe our use of <strong>Apollo.io</strong>, a business-audience tool that identifies
          the <em>organisation</em> — not the individual — associated with visitors to our educator
          and partner pages. It runs only on those pages, only where you have accepted advertising
          cookies, and never on student registration pages or the participant platform. The 10 Aug
          2026 update covered our cookie categories, the providers involved, and how to give or
          withdraw consent at any time via <strong>Cookie settings</strong> at the bottom of any
          page.
        </p>

        {/* 1. Introduction */}
        <h2 className="text-xl font-bold text-brand-blue-dark">1. Introduction</h2>
        <p>
          Stellr Education (&ldquo;Stellr,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates STEM competitions and an online
          community for middle and high school students. We are committed to protecting the privacy of all
          participants, including minors. This Privacy Policy explains what personal information we
          collect, how we use and protect it, and your rights regarding that information.
        </p>
        <p>
          By registering for a Stellr competition or creating an account on our platform, you (and,
          where applicable, your parent or guardian) agree to the practices described in this Policy.
        </p>
        <p>
          <strong>This Privacy Policy applies to:</strong>{' '}our website, competition registration
          portals, and online community platform (collectively, the &ldquo;Services&rdquo;).
        </p>

        {/* 2. Minors & COPPA */}
        <h2 className="text-xl font-bold text-brand-blue-dark">2. A Note About Minors, COPPA, and FERPA</h2>
        <p>
          Our Services are directed to school students, many of whom are under the age of 18, and
          some of whom may be under the age of 13. We comply with the{' '}
          <strong>Children&rsquo;s Online Privacy Protection Act (COPPA)</strong> and, where
          applicable, the <strong>Family Educational Rights and Privacy Act (FERPA)</strong>.
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Minors.</strong>{' '}In this policy, a &ldquo;Minor&rdquo; is anyone under the age
            of majority in their state of residence (18 in most states, 19 in Alabama and Nebraska,
            21 in Mississippi), anyone still enrolled in high school, or anyone who is a ward of the
            state or under guardianship. A person who has been legally emancipated is not a Minor
            once they give us proof. A Minor needs a parent or legal guardian to sign Stellr&rsquo;s
            Participation Agreement — Student / Minor (through DocuSign or Stellr&rsquo;s own
            signing system) before they can take part in Stellr activities. One signed agreement
            covers the student&rsquo;s membership and every Stellr activity, however they joined.
            The form is emailed to the parent or guardian address given at registration, and the
            parent or guardian signs first. We follow up on any form that is still outstanding
            before the event.
          </li>
          <li>
            <strong>How we confirm who is signing:</strong>{' '}The form is sent to the parent or
            guardian email address given at registration, and only the person who has that email
            can open it. Where the form is about a child, the person opening it also confirms the
            child&rsquo;s year of birth, and a parent or guardian confirms that they are the
            child&rsquo;s parent or legal guardian before signing. We record the date, time,
            internet address and browser of each signature, so it can be checked later.
          </li>
          <li>
            <strong>Participants under 13:</strong> We do not knowingly collect personal information
            from a child under 13 without the parental consent described above. A student under 13
            signs their own section of a form only after their parent or guardian has signed. If we
            discover we have collected a child&rsquo;s information without consent, we will delete
            it promptly. Parents or guardians may contact us at{' '}
            <a href="mailto:privacy@stellreducation.org" className="text-brand-blue hover:underline">
              privacy@stellreducation.org
            </a>{' '}
            to review, correct, or request deletion of their child&rsquo;s information. When a
            child under 13 creates an account themselves, before a parent consents we collect no
            more than the child&rsquo;s name, date of birth, and email address and the
            parent&rsquo;s name and email address, and we use them only to seek consent. A
            child&rsquo;s credential pages always stay private while the child is under 13. We do
            not disclose a child&rsquo;s personal information to third parties except to the
            service providers in Section 7.1 that we need to run our programs; we will not disclose
            it for any other purpose, such as advertising, without the parent&rsquo;s separate
            consent.
          </li>
          <li>
            <strong>Parent and guardian data:</strong>{' '}When we ask for consent, we collect the
            parent or guardian&rsquo;s full name, email address, phone number and relationship to
            the student. We use it to obtain and record consent, and as the student&rsquo;s
            emergency contact for the event. It is not used for marketing or shared beyond what is
            necessary.
          </li>
          <li>
            <strong>FERPA.</strong>{' '}We treat the information we hold about students as education
            records protected by FERPA. When a school registers students, we act as a &ldquo;school
            official&rdquo; under a data processing agreement with the school — our{' '}
            <a href="/school-data-terms" className="text-brand-blue hover:underline">School Data Terms</a>
            , which the registering teacher accepts on the school&rsquo;s behalf. When a student
            joins on their own, we apply the same protections. We use student information only to
            run our programs and do not disclose it except as FERPA permits or with consent. The
            signed Participation Agreement is the parent&rsquo;s (or, for a student aged 18 or over,
            the student&rsquo;s) written consent to the disclosures it describes, such as public
            credential pages and photo and media use. Section 7.7 explains this in full.
          </li>
          <li>
            <strong>Self-registration and pending accounts.</strong>{' '}Students may create a Stellr
            account themselves. When a Minor does, we ask for their date of birth and their
            parent&rsquo;s or legal guardian&rsquo;s name and email address, and send the parent or
            legal guardian the Participation Agreement. Until it is signed, the account is pending:
            we use the information only to seek consent and manage the pending account, the student
            cannot use the community portal, mentoring, courses, or event registration, no
            credential page can be made public, and we send the student only messages about the
            pending account. If consent is not given within 30 days, we delete the pending account
            and all information collected for it. We may take reasonable steps to confirm that the
            person consenting is the student&rsquo;s parent or legal guardian.
          </li>
          <li>
            <strong>Students who are adults but still in high school.</strong> Students who have
            reached the age of majority where they live but are still in high school are adults and
            agree to our terms in their own name. Because we have a duty of care to every high
            school student, we also require a parent or legal guardian to co-sign the Participation
            Agreement before the student can take part. By registering, the student authorizes us
            to share information about their account, consents, and participation with the
            co-signing parent or legal guardian, and to contact them in an emergency.
          </li>
          <li>
            <strong>Students&rsquo; own choices (age 13 and over).</strong> Students aged 13 or over
            make their own choices about uses of their information that are not needed to run their
            account, events, and courses. We use their photos, videos, name, and work in our
            promotional materials unless they or their parent or legal guardian opt out, which they
            can do at any time by emailing{' '}
            <a href="mailto:privacy@stellreducation.org" className="text-brand-blue hover:underline">
              privacy@stellreducation.org
            </a>
            . Credential pages stay private unless the student chooses to make each one public.
            Where state law requires a student&rsquo;s own agreement first (currently New York and
            Colorado), these uses stay off for students aged 13 to 17 until the student turns them
            on. Opting out never affects participation.
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

        <h3 className="text-lg font-semibold text-brand-blue-dark">3.4 Age, Date of Birth and Event Details</h3>
        <ul className="list-disc pl-6 space-y-1">
          <li>Date of birth or age range (used for age-group eligibility verification and COPPA compliance)</li>
          <li>Gender, where a registration form asks for it</li>
          <li>
            Ethnicity, where a registration form asks for it. It is used only in totals, to see
            whether our programmes reach a broad range of students, and is never published about an
            individual
          </li>
          <li>T-shirt size, for event shirts</li>
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
          <li>
            It is kept on your member record while you have an upcoming event, and deleted within
            90 days after the event unless it is needed for an incident record. You can change or
            remove it at any time (see Section 8)
          </li>
        </ul>

        <h3 className="text-lg font-semibold text-brand-blue-dark">3.6 Dietary Requirements</h3>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            Dietary restrictions or preferences disclosed for catered in-person events (e.g.,
            vegetarian, vegan, halal, kosher, nut allergy)
          </li>
          <li>Kept on your member record for future events; you can change or remove it at any time</li>
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
          <li>
            The <strong>organisation</strong> — for example a school, district, or company —
            associated with your IP address. This is inferred on our educator and partner pages
            only, and only where you have accepted advertising cookies. It tells us that
            &ldquo;someone at this school district read our educators page,&rdquo; not who you are
            (see Section 9.2)
          </li>
        </ul>

        <h3 className="text-lg font-semibold text-brand-blue-dark">3.10 Consent Forms, Agreements and Signing Records</h3>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            For a participant under 18: the parent or legal guardian&rsquo;s full name, email
            address, phone number and relationship to the student, as provided at registration or
            in the emergency contact fields
          </li>
          <li>
            The signed document itself — a parental consent form, a participation, mentor or
            membership agreement — including any choices made on it, such as opting out of photo and
            media use
          </li>
          <li>
            For every person who signs: their name and email address, the date and time they
            opened, agreed to sign electronically and signed, the internet (IP) address and browser
            they used, and the name they typed as their signature
          </li>
          <li>
            A tamper-evident audit trail of each step, and a fingerprint (hash) of the signed
            document, so a copy can be checked against the original
          </li>
        </ul>
        <p className="text-sm text-brand-grey-mid">
          Forms signed through Stellr&rsquo;s own signing system are generated and held by Stellr.
          Forms signed through DocuSign are held by DocuSign, and we keep our own copy of each,
          including DocuSign&rsquo;s certificate of completion. A typed signature is stored as text.
          If you choose to draw your signature instead, we keep the finished picture of it, with
          the signed form, and nothing about how it was drawn: no timing, pressure or pen-stroke
          data. Each completed form is sealed with Stellr&rsquo;s digital certificate and a trusted
          timestamp; the timestamp service receives only a fingerprint (hash), never the form.
          Signing records are used only to obtain and prove the signature. They are not used for
          marketing or analytics.
        </p>
        <p className="text-sm text-brand-grey-mid">
          We also record how the student joined Stellr (school or group registration, or
          self-registration), the version of the Participation Agreement signed, and, for students
          who are adults but still in high school, the co-signing parent&rsquo;s or legal
          guardian&rsquo;s name and email address.
        </p>

        <h3 className="text-lg font-semibold text-brand-blue-dark">3.11 Credentials</h3>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            Credentials we issue to you for completing a course or taking part in an event — the
            credential title, issue date, credential number, your role, and any award
          </li>
          <li>Whether each credential page is private or public, which you control</li>
          <li>
            Activity on your credential pages — how many times a page was viewed, and when you used
            the share, copy-link, or download buttons. We record the action and the time, not who
            viewed the page
          </li>
        </ul>

        {/* 4. How We Collect */}
        <h2 className="text-xl font-bold text-brand-blue-dark">4. How We Collect Information</h2>
        <p>We collect personal information in the following ways:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li><strong>Directly from you</strong> when you register, create an account, complete forms, or communicate with us</li>
          <li><strong>From parents or guardians</strong> providing consent or registering on behalf of a minor</li>
          <li><strong>Via electronic consent forms and agreements</strong> that parents, guardians, participants, mentors and members sign through Stellr&rsquo;s own signing system or through DocuSign; for DocuSign, the signed form and its signing record are returned to us when everyone has signed</li>
          <li><strong>From schools and educators</strong> facilitating group registrations</li>
          <li><strong>Automatically</strong> through cookies and analytics tools when you use our platform</li>
          <li><strong>From payment processors</strong> who provide transaction confirmation data</li>
        </ul>

        {/* 5. How We Use */}
        <h2 className="text-xl font-bold text-brand-blue-dark">5. How We Use Your Information</h2>
        <p>We use collected information for the following purposes:</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse border border-line">
            <thead>
              <tr className="bg-surface">
                <th className="border border-line px-4 py-2 text-left font-semibold">Purpose</th>
                <th className="border border-line px-4 py-2 text-left font-semibold">Data Used</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Registering and managing competition participation', 'Identity, school, age, account data'],
                ['Verifying age eligibility and triggering parental consent', 'Date of birth / age'],
                ['Obtaining parental consent for minor participants, and agreements from participants, mentors and members', 'Parent/guardian name, email, phone and relationship; participant name, date of birth, school and event details (signed through Stellr signing or DocuSign)'],
                ['Showing that a signature is genuine, if it is ever questioned', 'Signing records: name, email, IP address, browser, timestamps, audit trail'],
                ['Managing pending accounts and contacting a parent or legal guardian for consent', 'Student name, date of birth, and email; parent or guardian name and email'],
                ['Providing access to the online community', 'Account / login credentials'],
                ['Communicating with participants about competitions and results', 'Contact information'],
                ['Ensuring participant safety at in-person events', 'Medical requirements (deleted within 90 days after the event) and dietary requirements'],
                ['Supervision and emergency contact for students attending in-person events without a school group', 'Parent or guardian contact details; name and contact details of a designated responsible adult'],
                ['Processing registration payments and refunds', 'Billing history'],
                ['Publishing competition results, photos, and highlights', 'Photos, videos, name'],
                ['Issuing verifiable credentials, and showing a credential page publicly when you choose to (credential pages of children under 13 are never public)', 'Name, credential details, date of birth (to apply the age rules in Section 7.4), parental consent record for students under 18'],
                ['Improving our Services through analytics', 'Technical and usage data'],
                ['Understanding which schools and organisations are interested in partnering with us', 'Technical data and inferred organisation — educator and partner pages only, with advertising consent'],
                ['Complying with legal obligations', 'All categories as required'],
                ['Responding to enquiries and support requests', 'Contact information'],
              ].map(([purpose, data]) => (
                <tr key={purpose} className="even:bg-surface">
                  <td className="border border-line px-4 py-2">{purpose}</td>
                  <td className="border border-line px-4 py-2">{data}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          We do <strong>not</strong> sell your information to third parties, and we do not use it in
          automated decision-making that produces legal or similarly significant effects.
        </p>
        <p>
          We do <strong>not</strong> use the information you give us — your name, email, registration
          details, or anything in your account — for targeted advertising. Where you have accepted
          advertising cookies, we measure our advertising using cookie identifiers only, in aggregate,
          to understand which campaigns bring people to our programmes. Registration and education
          records are never used for this purpose (see Sections 7.7 and 9).
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
        <p>We engage trusted third-party vendors to assist in delivering our Services. Our current subprocessors include:</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse border border-line">
            <thead>
              <tr className="bg-surface">
                <th className="border border-line px-4 py-2 text-left font-semibold">Provider</th>
                <th className="border border-line px-4 py-2 text-left font-semibold">Purpose</th>
                <th className="border border-line px-4 py-2 text-left font-semibold">Data Shared</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Stripe', 'Payment processing', 'Name, billing address, payment card data'],
                ['Supabase', 'Cloud database, file storage and hosting (United States)', 'All account and registration data, signed consent forms and agreements, and their signing records'],
                ['Clerk', 'User authentication and identity', 'Name, email, login credentials'],
                ['Resend', 'Transactional email delivery, including requests to sign and copies of signed documents', 'Name, email address, and the content of the email — including the private link to sign or download a document. Signed documents are never sent as attachments'],
                ['DocuSign', 'Electronic consent for Minors (parent or guardian, and the student where they have reached the age of majority), and other agreements, until our DocuSign contract ends in 2027', "Student name, membership or event name, parent or guardian name and email, and for students who are adults, the student's email, with the other details pre-filled on the form; DocuSign keeps its own copy of signed forms under its data processing terms"],
                ['Vercel', 'Website hosting and delivery, and aggregate page analytics (Vercel Analytics)', 'Usage/technical data, including the internet address and browser of people who sign documents. Page analytics do not run on signing pages'],
                ['Google Workspace', 'Staff email and documents; spreadsheets schools use to send us their group roster; an encrypted backup copy of signed agreements', 'Group roster details a school shares (which can include names, dates of birth, health information and emergency contacts). Backup copies are encrypted before they leave our systems, with a key Google does not hold'],
                ['Checkr', 'Background checks for adult mentors and volunteers', 'Name and email, and the details you give Checkr directly'],
                ['Printful', 'Making and shipping orders from our online store', 'Name and delivery address for your order'],
                ['Discord', 'Community chat, for members who choose to join it', 'Your Discord username and what you post there'],
                ['Timestamp authority (from mid-October 2026)', 'Adding a trusted timestamp to signed agreements', 'A one-way fingerprint (hash) of the document only — no personal information'],
                ['Sanity', 'Content management', 'No personal data'],
                ['HubSpot', 'Marketing contact management and enquiry handling', 'Name, email, and the enquiry you submitted'],
                ['Google (Analytics, Tag Manager, Ads)', 'Aggregate website analytics; advertising measurement where you have accepted advertising cookies', 'Usage/technical data and cookie identifiers — no name, email, or registration data. Not loaded on signing pages or on private payment and join links'],
                ['Meta and LinkedIn', 'Advertising measurement, configured within Google Tag Manager, only where you have accepted advertising cookies', 'Cookie identifiers and pages visited — no name, email, or registration data. Not loaded on signing pages or private links'],
                ['Apollo.io', 'Identifying the organisation associated with visitors to our educator and partner pages, where you have accepted advertising cookies', "IP address, cookie identifiers, and the pages visited — no name, email, or registration data; not loaded on student registration pages or the participant platform. Governed by Apollo's standard Data Processing Addendum, linked below"],
              ].map(([provider, purpose, data]) => (
                <tr key={provider} className="even:bg-surface">
                  <td className="border border-line px-4 py-2 font-medium">{provider}</td>
                  <td className="border border-line px-4 py-2">{purpose}</td>
                  <td className="border border-line px-4 py-2 text-xs text-brand-grey-mid">{data}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          All providers are contractually required to handle your data securely, use it only as
          directed by us, and not disclose it to third parties for their own commercial purposes.
          Data processing terms apply to each provider in one of two ways: an agreement executed
          directly between that provider and Stellr, or the provider&rsquo;s own standard data
          processing addendum, which governs our use of their service. Where the arrangement is
          specific to Stellr, the table above says so.
        </p>
        <p>
          Two providers are worth naming directly. Our business-audience provider{' '}
          <strong>Apollo.io</strong> operates under its standard GDPR data processing addendum,
          published at{' '}
          <a
            href="https://www.apollo.io/dpa"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-blue hover:underline"
          >
            apollo.io/dpa
          </a>

          . <strong>DocuSign</strong> handles the forms signed through it under its standard data
          processing terms; when our DocuSign contract ends, it will no longer receive new
          information from us. If we add a provider that receives personal information, we will
          add it to this table before it does.
        </p>

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

        <h3 id="credentials" className="text-lg font-semibold text-brand-blue-dark scroll-mt-24">7.4 Public Recognition and Credentials</h3>
        <p>
          Unless you opt out, competition results, names, school affiliations, and photographs may
          be published on our website, social media channels, or press releases. For participants
          under 18, the parent or guardian consent form includes our photo and media permission,
          with a box to opt out; opting out does not affect participation. We do not publish
          identifiable photographs or video of a participant whose parent or guardian has opted
          out, and anyone can ask us to remove a photograph at any time. Students aged 13 or over
          can also opt out themselves, and students aged 13 to 17 in New York and Colorado are
          opted out until they opt in (Section 2).
        </p>
        <p>
          <strong>Credential pages.</strong> When you complete a Stellr course or take part in a
          Stellr event, we issue a verifiable credential with its own web page showing your name,
          the credential title, the issuing program, the issue date, and a credential number. Every
          credential page is <strong>private by default</strong>. You choose whether to make it
          public, and you can make it private again at any time from your Stellr account. Once a
          page is public, anyone with the link can view it. Credential pages are not submitted to
          search engines.
        </p>
        <p>
          <strong>Sharing on LinkedIn.</strong> From a public credential page you can choose to add
          the credential to your LinkedIn profile or share it in a LinkedIn post. Stellr does not
          connect to your LinkedIn account and does not send your information to LinkedIn. The
          buttons open LinkedIn with the credential details filled in, and you decide whether to
          save or post them. When a credential page is shared, LinkedIn reads that public page,
          including your name and the credential image. LinkedIn requires its members to be 16 or
          older, so these buttons are not shown to anyone under 16.
        </p>
        <p>
          <strong>Once shared, it is out of our hands.</strong>{' '}After you add a credential to
          LinkedIn or share it there, what happens to that information is governed by
          LinkedIn&rsquo;s terms and privacy policy, not ours. Stellr cannot control, change, or
          remove what LinkedIn — or anyone who has seen or copied the post — does with it, and
          LinkedIn may keep its own copy of the post preview. Making the page private, or asking us
          to revoke or erase a credential, changes the page on our site: it stops showing your name
          and shows the credential as private, revoked, or withdrawn, so that anyone checking the
          link is not misled. To remove a LinkedIn profile entry or post, delete it on LinkedIn.
        </p>
        <p>
          <strong>Students who are Minors.</strong> Permission for a Minor to make credential pages
          public is part of the Participation Agreement their parent or legal guardian signs.
          Parents and guardians may decline, or withdraw permission at any time by contacting{' '}
          <a href="mailto:privacy@stellreducation.org" className="text-brand-blue hover:underline">
            privacy@stellreducation.org
          </a>
          , and any public pages are made private. Credential pages of a child under 13 always stay
          private, and no credential page can be made public while an account is pending consent.
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

        <h3 className="text-lg font-semibold text-brand-blue-dark">7.7 FERPA — Education Records</h3>
        <p>
          We treat the information we hold about students as education records protected by FERPA,
          however it reaches us:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>From a school or teacher</strong> registering a group. We act as a &ldquo;school
            official&rdquo; under a data processing agreement with the school: our{' '}
            <a href="/school-data-terms" className="text-brand-blue hover:underline">School Data Terms</a>
            , which the registering teacher accepts on the school&rsquo;s behalf, or the
            school&rsquo;s own agreement where it has one. We use that information only to run the
            competition, never for advertising, profiling or product development, and we do not
            disclose it to anyone else except as FERPA and the agreement allow (for example, to the
            providers in Section 7.1 that host our services). We delete it within 30 days of the
            school&rsquo;s request, or sooner if the school&rsquo;s agreement requires.
          </li>
          <li>
            <strong>From a parent, guardian or student directly</strong>, including everything on a
            signed consent form or agreement. We apply these protections to all student information
            on our platform, including for students who join on their own without a school. After a
            deletion request, we keep only the minimal signed-agreement record described in Section
            10.
          </li>
          <li>
            Schools and parents may exercise their rights by contacting us at{' '}
            <a href="mailto:privacy@stellreducation.org" className="text-brand-blue hover:underline">
              privacy@stellreducation.org
            </a>
            .
          </li>
        </ul>

        {/* 8. Sensitive Information */}
        <h2 className="text-xl font-bold text-brand-blue-dark">8. Sensitive Information</h2>
        <p>We treat the following categories as <strong>sensitive</strong> and apply heightened protections:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li><strong>Medical and health information</strong> — collected solely for participant safety; accessible only to staff with a direct need; never shared with sponsors, partners, or the public; deleted within 90 days after the event unless it is needed for an incident record. You can change or remove it sooner at any time in your account, or ask us to delete it</li>
          <li><strong>Dietary requirements</strong> — used only for event catering, and kept under our standard retention periods (Section 10); you can change or remove it at any time</li>
          <li><strong>Signing records</strong> — the internet address and browser recorded when you sign are used only to show the signature is yours; never used for analytics or advertising</li>
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
          <li>
            Measure whether our advertising reaches the students, families and educators it is
            meant to reach — <strong>only if you accept advertising cookies</strong>
          </li>
          <li>
            Recognise which schools, districts and organisations are reading our educator and
            partner pages, so we can follow up with those exploring a partnership —{' '}
            <strong>only if you accept advertising cookies</strong>
          </li>
        </ul>

        <h3 className="text-lg font-semibold text-brand-blue-dark">9.1 Categories We Use</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse border border-line">
            <thead>
              <tr className="bg-surface">
                <th className="border border-line px-4 py-2 text-left font-semibold">Category</th>
                <th className="border border-line px-4 py-2 text-left font-semibold">Purpose</th>
                <th className="border border-line px-4 py-2 text-left font-semibold">Consent</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Essential', 'Login sessions, security, and core site function', 'Always on — the site cannot work without these'],
                ['Analytics', 'Aggregate usage measurement (Google Analytics, HubSpot)', 'On by default; denied until you accept in the UK, EEA and Switzerland; limited for children under 13 (Section 9.4)'],
                ['Advertising', 'Campaign measurement and remarketing (Google Ads, Meta, LinkedIn); business-audience identification on educator and partner pages (Apollo.io)', 'Off until you accept; never for students or children under 13 (Section 9.4)'],
              ].map(([category, purpose, consent]) => (
                <tr key={category} className="even:bg-surface">
                  <td className="border border-line px-4 py-2 font-medium">{category}</td>
                  <td className="border border-line px-4 py-2">{purpose}</td>
                  <td className="border border-line px-4 py-2 text-xs text-brand-grey-mid">{consent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="text-lg font-semibold text-brand-blue-dark">9.2 Business-Audience Identification</h3>
        <p>
          Stellr works with schools, districts, universities, and sponsoring organisations as well
          as with students. To understand which of those organisations are interested in partnering
          with us, we use <strong>Apollo.io</strong> on our educator and partner pages. It matches
          the IP address a visit comes from against a database of business networks and tells us the
          organisation that address belongs to.
        </p>
        <p>We want to be precise about the limits of this:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>It identifies organisations, not people.</strong> It tells us that someone at a
            given school district or company visited a page. It does not tell us your name, your
            email address, or anything about you as an individual, and we do not attempt to combine
            it with registration data to work out who you are.
          </li>
          <li>
            <strong>It runs on a limited set of pages only</strong> — our educator, host-an-event,
            mentor, network, volunteer, impact, and why-Stellr pages. It is{' '}
            <strong>not</strong> loaded on competition registration pages, on the participant
            platform, or anywhere a student is signing up or logged in.
          </li>
          <li>
            <strong>It requires your consent.</strong> Apollo.io is an advertising-category cookie
            and does not load at all until you accept advertising cookies. If you decline, or later
            withdraw, it is never loaded.
          </li>
          <li>
            <strong>Home and school networks are generally not identifiable</strong> in this way.
            The matching relies on business network records, so most residential connections return
            no organisation at all.
          </li>
        </ul>

        <h3 className="text-lg font-semibold text-brand-blue-dark">9.3 Your Choices</h3>
        <p>
          When you first visit, we ask whether to enable advertising cookies. Until you accept,
          advertising and remarketing tags are disabled — we use Google Consent Mode, so the choice
          is enforced on the tags themselves rather than only recorded.
        </p>
        <p>
          <strong>You can change your mind at any time.</strong> Select{' '}
          <strong>Cookie settings</strong> at the bottom of any page to reopen the banner and turn
          advertising cookies on or off. Withdrawing takes exactly as many clicks as giving, and
          takes effect immediately — no further advertising data is sent from that point, and on
          your next visit those tags do not load at all.
        </p>
        <p>
          We do <strong>not</strong> sell your personal information, and we do not use advertising
          cookies to build profiles of individual students. Advertising measurement is used to
          understand which campaigns bring people to our programmes in aggregate. Disabling
          non-essential cookies does not affect your ability to register for or take part in any
          Stellr event.
        </p>

        <h3 className="text-lg font-semibold text-brand-blue-dark">9.4 Students, and Children Under 13</h3>
        <p>
          Advertising cookies and tags (including Google Ads remarketing and Apollo.io) are never
          loaded on registration pages, on the participant platform, or for any signed-in student,
          whatever the cookie settings. For a child under 13, this applies even if
          &ldquo;Accept&rdquo; was selected in Cookie settings, because a child cannot give that
          consent. For children under 13 we use analytics only to operate, secure, and improve our
          Services, as COPPA permits for the support of internal operations, and never to build a
          profile of the child, to target advertising, or to share identifiers with third parties
          for those purposes.
        </p>

        {/* 10. Data Retention */}
        <h2 className="text-xl font-bold text-brand-blue-dark">10. Data Retention</h2>
        <p>
          This section is our written data retention policy, including for personal information
          collected from children under 13 (16 CFR 312.10). We keep student information for the
          duration of membership and for seven years after an account is deactivated so that we
          hold a record of consents and participation if questions or claims arise after a student
          leaves, and so that we can verify credentials we have issued. When a retention period
          ends, we securely delete the information. A school, parent, guardian, or student may ask
          us to delete it sooner (Section 12). We delete it within 30 days of the request, or
          sooner if a school&rsquo;s agreement with us requires it. We keep only a minimal record
          of the signed Participation Agreement (the names of the student and signers, the dates,
          and the signed document) until seven years after the account is deactivated, so that we
          can show what was agreed if a question or claim arises later. The parent or legal
          guardian (or adult student) consents to us keeping this record when they sign.
        </p>
        <p>We retain personal information only as long as necessary:</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse border border-line">
            <thead>
              <tr className="bg-surface">
                <th className="border border-line px-4 py-2 text-left font-semibold">Data Type</th>
                <th className="border border-line px-4 py-2 text-left font-semibold">Retention Period</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Account and competition records', 'Duration of membership + 7 years after deactivation (all ages, including under 13)'],
                ['Pending accounts with no parental consent', 'Deleted within 30 days of registration'],
                ['Medical information', '90 days after the event, unless needed for an incident record. You can remove it sooner at any time'],
                ['Dietary information', 'Same as account and competition records, so it is ready for future events. You can remove it at any time'],
                ['Payment transaction records', '7 years (US tax/accounting requirements)'],
                ['Signed consent forms and agreements, and their signing records (names, emails, internet address, browser, timestamps, audit trail)', 'Duration of membership + 7 years after deactivation. After a deletion request, only the minimal signed-agreement record is kept, restricted so it can be produced if a claim is made and used for nothing else'],
                ['Encrypted backup copies of signed agreements', 'Deleted with the original. Our nightly encrypted database copies, which may also contain it, are each kept for 30 days'],
                ['Requests to sign that are never completed', 'Cancelled 30 days after the last signing link we sent, and everything entered on the form (including any partial signature) deleted then; the request itself is deleted with the participant record'],
                ['Data subject to a deletion request (school, parent, or student)', "Deleted within 30 days of the request (sooner if a school's agreement requires), except the minimal signed-agreement record"],
                ['Parent/guardian contact information', 'Duration of account, or until the associated minor participant record is deleted. The copy within a signed consent form is kept with that form'],
                ['Profile photos', 'Same as account and competition records'],
                ['Event photos and videos', 'Until removal is requested; reviewed every 2 years, and deleted when no longer needed'],
                ['Credentials', 'Duration of account. If you ask us to erase your data, the credential number is kept so a copy can be checked, but your name is removed and the page shows the credential as withdrawn'],
                ['Credential page activity (views and share clicks)', 'Duration of the credential; deleted with it'],
                ['Technical/usage logs', 'Generally 12 months, with minor exceptions on a platform-specific basis'],
              ].map(([type, period]) => (
                <tr key={type} className="even:bg-surface">
                  <td className="border border-line px-4 py-2">{type}</td>
                  <td className="border border-line px-4 py-2">{period}</td>
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
          <li>
            Signed documents are kept in private storage and can be opened only through a link that
            expires within minutes, issued after we check who is asking. Every time a signed
            document is opened, we record who opened it
          </li>
          <li>
            Each signing step is written to an audit trail that cannot be edited, where every entry
            carries a fingerprint of the one before it, so any change would show
          </li>
          <li>Pages reached through a private link (to sign, pay or join) load no analytics or advertising tags</li>
          <li>Regular security reviews of our platform</li>
          <li>
            If a data breach affects you, we will tell you without unreasonable delay and as
            applicable law requires (for Colorado residents, within 30 days of determining the
            breach), and tell any school whose students are affected as our School Data Terms
            require
          </li>
        </ul>
        <p>
          Our main database and file storage are in the United States.
        </p>
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
          <li><strong>Deletion</strong> — request deletion. We delete within 30 days, keeping only the minimal signed-agreement record described in Section 10</li>
          <li><strong>Paper copies</strong> — sign on paper instead of electronically, or ask for a paper copy of anything you have signed, at no cost</li>
          <li><strong>Withdrawal of consent</strong> — withdraw consent for processing based on consent (e.g., for publication of photos)</li>
          <li><strong>Credential privacy</strong> — make any credential page private at any time from your Stellr account</li>
          <li><strong>Opt-out of communications</strong> — unsubscribe from non-essential emails at any time</li>
        </ul>
        <p>
          To make a request, use our{' '}
          <a href="/privacy/request" className="text-brand-blue hover:underline">privacy request form</a> or email{' '}
          <a href="mailto:privacy@stellreducation.org" className="text-brand-blue hover:underline">privacy@stellreducation.org</a>.
          We email a link to the address you give, to confirm the request came from you, and answer within 30 days of
          confirmation. Requests never confirmed are deleted after 30 days; we keep a record of how each confirmed
          request was answered for 3 years.
        </p>

        <h3 className="text-lg font-semibold text-brand-blue-dark">Parents and Guardians (COPPA Rights)</h3>
        <ul className="list-disc pl-6 space-y-2">
          <li>Review personal information collected from your child under 13</li>
          <li>Request correction or deletion of that information (only the minimal signed-agreement record is kept, as described in Section 10)</li>
          <li>Withdraw consent you have given, including to photo and media use</li>
          <li>Refuse further collection or use of your child&rsquo;s information</li>
          <li>
            Decline public credential pages for your child under 18 — any pages already public are
            made private (see Section 7.4)
          </li>
          <li>
            Contact us at any time:{' '}
            <a href="mailto:privacy@stellreducation.org" className="text-brand-blue hover:underline">
              privacy@stellreducation.org
            </a>
          </li>
        </ul>
        <p>
          For a student who has reached the age of majority but is still in high school, the
          student exercises these rights in their own name. Their co-signing parent or legal
          guardian receives the information the student has authorized us to share (Section 2).
        </p>

        <h3 className="text-lg font-semibold text-brand-blue-dark">FERPA Rights</h3>
        <p>
          Parents of students who are Minors under the age of majority, and adult students, may
          exercise these rights directly with us, including where the student joined Stellr on
          their own. Schools and educators may exercise them for students they registered.
        </p>
        <p>
          Schools whose students&rsquo; education records are processed by Stellr have the right to:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Inspect and review the records the school shared with Stellr about its students</li>
          <li>Request correction of inaccurate records</li>
          <li>
            Request deletion of those records. We delete within 30 days, or sooner if the
            school&rsquo;s agreement requires, keeping only the minimal signed-agreement record
            described in Section 10
          </li>
          <li>Receive a copy of our School Data Terms and of our list of providers (Section 7.1)</li>
        </ul>
        <p>
          Contact us at{' '}
          <a href="mailto:privacy@stellreducation.org" className="text-brand-blue hover:underline">
            privacy@stellreducation.org
          </a>{' '}
          with the subject line <strong>FERPA Request</strong>.
        </p>

        <h3 className="text-lg font-semibold text-brand-blue-dark">California Residents (CCPA/CPRA)</h3>
        <p>California residents have additional rights under the California Consumer Privacy Act:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Right to know what personal information is collected, used, shared, or sold</li>
          <li>Right to delete personal information</li>
          <li>
            Right to opt out of the sale or sharing of personal information.{' '}
            <strong>We do not sell personal information.</strong>{' '}Where you have accepted
            advertising cookies, technical identifiers may be disclosed to our advertising and
            business-audience providers in a way that CPRA treats as &ldquo;sharing&rdquo; for
            cross-context behavioural advertising. You can opt out at any time by selecting{' '}
            <strong>Cookie settings</strong> at the bottom of any page
          </li>
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
          organisations, competition hosts) and to <strong>LinkedIn</strong>, where you can choose to
          add or share a credential (see Section 7.4). We are not responsible for the privacy
          practices of those sites and encourage you to review their policies independently.
        </p>

        {/* 14. Changes */}
        <h2 className="text-xl font-bold text-brand-blue-dark">14. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. When we do, we will post the revised
          version on this page with an updated &ldquo;Last Updated&rdquo; date and a notice at the top of
          the page summarising what changed. Except as described below, we give notice of changes
          on our public website only; we do not send notice by email. Please check this page from
          time to time. Continued use of our Services after a change is posted constitutes
          acceptance of the updated Policy.
        </p>
        <p>
          If a change materially affects how we collect, use, or disclose the personal information
          of a Minor whose parent or legal guardian has consented, including any child under 13, we
          will email the parent or legal guardian and obtain new consent before the change applies
          to that student. Continued use alone is not treated as consent for these changes.
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
