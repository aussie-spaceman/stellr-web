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
          Effective Date: 18-Jun-2026 &nbsp;·&nbsp; Last Updated: 18-Jun-2026
        </p>

        {/* The short version */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4 not-prose">
          <h2 className="text-sm font-bold uppercase tracking-wide text-brand-blue mb-2">
            The short version
          </h2>
          <p className="text-sm text-brand-blue-dark mb-2">
            This summary is for convenience only and is not a substitute for the full Terms below,
            which govern your use of Stellr.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-sm text-brand-blue-dark">
            <li>
              Stellr runs STEM competitions, an online community, an Academy, and related programs
              for school students. Many participants are minors, so a parent, guardian, or school
              must be involved.
            </li>
            <li>Keep your account secure, give accurate information, and treat others with respect.</li>
            <li>
              You keep ownership of the work you create; you give us permission to display and
              promote it.
            </li>
            <li>
              Some memberships and events have fees. Read the billing and refund terms before you pay.
            </li>
            <li>
              Our programs are educational — we can&rsquo;t guarantee specific outcomes, and there are
              limits on our liability.
            </li>
            <li>If something goes wrong, contact us first; these Terms are governed by Utah law.</li>
          </ul>
        </div>

        {/* Contents */}
        <nav aria-label="Table of contents" className="bg-gray-50 border border-gray-200 rounded-lg px-5 py-4 not-prose">
          <h2 className="text-sm font-bold uppercase tracking-wide text-brand-grey-mid mb-2">
            Contents
          </h2>
          <ol className="list-decimal pl-5 space-y-1 text-sm sm:columns-2 sm:gap-8">
            {[
              ['accept', 'Acceptance of These Terms'],
              ['who', 'Who We Are'],
              ['related', 'These Terms and Other Agreements'],
              ['eligibility', 'Eligibility, Accounts & Minors'],
              ['services', 'Our Services'],
              ['membership', 'Membership Plans, Fees & Billing'],
              ['competitions', 'Competition Registration & Participation'],
              ['events', 'In-Person Events & Safety'],
              ['refunds', 'Refunds & Cancellations'],
              ['acceptable', 'Acceptable Use & Community Conduct'],
              ['usercontent', 'Your Content & Competition Submissions'],
              ['ourip', 'Our Intellectual Property'],
              ['thirdparty', 'Third-Party Services & Links'],
              ['privacy', 'Privacy'],
              ['donations', 'Donations'],
              ['disclaimers', 'Disclaimers'],
              ['liability', 'Limitation of Liability'],
              ['indemnity', 'Indemnification'],
              ['termination', 'Suspension & Termination'],
              ['changes', 'Changes to the Services and These Terms'],
              ['disputes', 'Dispute Resolution & Governing Law'],
              ['general', 'General Terms'],
              ['contact', 'Contact Us'],
            ].map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-brand-grey-dark hover:text-brand-blue hover:underline">
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {/* 1. Acceptance */}
        <h2 id="accept" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          1. Acceptance of These Terms
        </h2>
        <p>
          These Terms of Use (the &ldquo;Terms&rdquo;) are a legal agreement between you and Stellr
          (defined below). They govern your access to and use of our website at{' '}
          <a href="https://www.stellreducation.org" className="text-brand-blue hover:underline">
            stellreducation.org
          </a>
          , our competition registration portals, our online community platform (including any
          associated member application at{' '}
          <a href="https://app.stellreducation.org" className="text-brand-blue hover:underline">
            app.stellreducation.org
          </a>
          ), our Academy and curriculum resources, our events, and any other services that link to
          these Terms (collectively, the &ldquo;Services&rdquo;).
        </p>
        <p>
          By accessing or using the Services, creating an account, registering for a competition,
          purchasing a membership, or otherwise indicating your acceptance, you agree to be bound by
          these Terms and by our{' '}
          <Link href="/privacy" className="text-brand-blue hover:underline">
            Privacy Policy
          </Link>
          . If you do not agree, please do not use the Services.
        </p>
        <p>
          <strong>If you are under 18</strong>, you may use the Services only with the involvement
          and consent of a parent, legal guardian, or authorized school official, who must agree to
          these Terms on your behalf. See Section 4.
        </p>

        {/* 2. Who We Are */}
        <h2 id="who" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          2. Who We Are
        </h2>
        <p>
          The Services are operated by <strong>Stellr</strong>, a Utah nonprofit corporation doing
          business as &ldquo;Stellr Education&rdquo; (&ldquo;Stellr,&rdquo; &ldquo;we,&rdquo;
          &ldquo;us,&rdquo; or &ldquo;our&rdquo;). Stellr was formerly known as Industry Simulation
          Education, and some of our branding and social media channels still use that name.
          Stellr&rsquo;s mission is to connect middle and high school students with industry
          professionals through real-world STEM competitions, community, and career pathways.
        </p>

        {/* 3. Other Agreements */}
        <h2 id="related" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          3. These Terms and Other Agreements
        </h2>
        <p>
          Some parts of the Services have additional terms — for example, specific competition rules,
          event participation and consent forms, membership descriptions, and our Privacy Policy. By
          using those parts of the Services, you also agree to the additional terms that apply to
          them. The additional terms are part of these Terms.
        </p>
        <p>
          If an additional term directly conflicts with these Terms, the additional term controls for
          that specific feature, competition, or event — but only to the extent of the conflict. Our
          Privacy Policy governs how we handle personal information and is incorporated by reference.
        </p>

        {/* 4. Eligibility */}
        <h2 id="eligibility" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          4. Eligibility, Accounts &amp; Minors
        </h2>
        <h3 className="text-lg font-semibold text-brand-blue-dark">4.1 Who may use the Services</h3>
        <p>
          The Services are intended for users located in the United States. You may create an account
          on your own behalf only if you are 18 or older. Students under 18 may participate, but only
          through a parent, legal guardian, or authorized school official who registers for them or
          supervises their account.
        </p>
        <h3 className="text-lg font-semibold text-brand-blue-dark">4.2 Parents, guardians, and schools</h3>
        <p>
          If you register a minor, create or supervise a minor&rsquo;s account, or accept these Terms
          for a minor, you represent that you are the minor&rsquo;s parent or legal guardian, or an
          authorized school official with the right to do so. You agree to these Terms on the
          minor&rsquo;s behalf and are responsible for their use of the Services. Where a participant
          is under 18, we require verifiable parental or guardian consent before confirming
          participation, collected electronically as described in our{' '}
          <Link href="/privacy" className="text-brand-blue hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
        <h3 className="text-lg font-semibold text-brand-blue-dark">4.3 Educators and group registrations</h3>
        <p>
          If you are a teacher or school representative registering a group of students, you represent
          that you are authorized to do so and have obtained any consents your school requires. Where
          student records are involved, we handle them consistent with FERPA and our Privacy Policy,
          and we enter into a data processing agreement with the school where applicable.
        </p>
        <h3 className="text-lg font-semibold text-brand-blue-dark">4.4 Your account</h3>
        <p>
          You agree to provide accurate, current, and complete information and to keep it up to date.
          You are responsible for keeping your login credentials secure and for all activity that
          occurs under your account. Do not share your account or let anyone else use it. Notify us
          promptly at{' '}
          <a href="mailto:hello@stellreducation.org" className="text-brand-blue hover:underline">
            hello@stellreducation.org
          </a>{' '}
          if you suspect unauthorized use.
        </p>

        {/* 5. Our Services */}
        <h2 id="services" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          5. Our Services
        </h2>
        <p>The Services may include, depending on your role and membership:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Competitions and activities</strong> — design challenges, registration portals,
            and related curriculum and resources.
          </li>
          <li>
            <strong>Community</strong> — an online community and member platform, which may include
            forums and third-party spaces such as Discord.
          </li>
          <li>
            <strong>Academy</strong> — training, mentoring, and coaching programs.
          </li>
          <li>
            <strong>Events</strong> — in-person and virtual events hosted by Stellr or our partners.
          </li>
          <li>
            <strong>Resources</strong> — downloadable curriculum and educational materials.
          </li>
          <li>
            <strong>Donations</strong> — the ability to support our mission financially.
          </li>
        </ul>
        <p>
          We may add, change, suspend, or remove features of the Services at any time. We aim to keep
          the Services available but do not guarantee uninterrupted access.
        </p>

        {/* 6. Membership */}
        <h2 id="membership" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          6. Membership Plans, Fees &amp; Billing
        </h2>
        <p>
          We offer free and paid membership tiers. The current tiers, prices, and benefits are
          described on our{' '}
          <Link href="/membership" className="text-brand-blue hover:underline">
            Membership page
          </Link>
          , which forms part of these Terms. Prices are in U.S. dollars and may exclude applicable
          taxes.
        </p>
        <h3 className="text-lg font-semibold text-brand-blue-dark">6.1 Payments</h3>
        <p>
          Paid memberships, competition registration fees, and other purchases are processed by our
          third-party payment processor, Stripe. By paying, you authorize us and our processor to
          charge the payment method you provide. You are responsible for any taxes that apply to your
          purchase.
        </p>
        <h3 className="text-lg font-semibold text-brand-blue-dark">6.2 Subscriptions and automatic renewal</h3>
        <p>
          Paid memberships are billed in advance on a recurring basis (for example, annually) and{' '}
          <strong>automatically renew</strong> at the then-current price unless you cancel before the
          renewal date. You can cancel automatic renewal at any time through your account settings or
          by contacting us; cancellation stops future charges and takes effect at the end of your
          current paid period.
        </p>
        <h3 className="text-lg font-semibold text-brand-blue-dark">6.3 Price changes</h3>
        <p>
          We may change membership prices or fees. If a change affects a recurring subscription, we
          will give you advance notice, and the new price will apply from your next renewal. If you do
          not agree to the new price, you may cancel before it takes effect.
        </p>
        <h3 className="text-lg font-semibold text-brand-blue-dark">6.4 Purchases for minors</h3>
        <p>
          If a purchase relates to a minor, it must be made or authorized by the minor&rsquo;s parent,
          guardian, or authorized school official.
        </p>

        {/* 7. Competitions */}
        <h2 id="competitions" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          7. Competition Registration &amp; Participation
        </h2>
        <h3 className="text-lg font-semibold text-brand-blue-dark">7.1 Registration and eligibility</h3>
        <p>
          Competitions have their own eligibility criteria (such as age group, grade level, and team
          rules) and specific rules, deadlines, and judging criteria published with each event. By
          registering, you agree to follow those rules and the decisions of our judges and organizers.
        </p>
        <h3 className="text-lg font-semibold text-brand-blue-dark">7.2 Original work and integrity</h3>
        <p>
          Competition submissions must be the original work of the participating student(s), created
          for the competition unless the rules say otherwise. You must have the rights to anything you
          include in a submission, and you may not plagiarize, misrepresent authorship, cheat, or
          violate the spirit of fair competition.
        </p>
        <h3 className="text-lg font-semibold text-brand-blue-dark">7.3 Judging, results, and prizes</h3>
        <p>
          Judging decisions and results are final, except where the published rules provide a review
          process. Prizes, awards, and scholarships (if any) are described with each competition, are
          non-transferable unless stated, and may be subject to verification of eligibility and to the
          prize provider&rsquo;s terms. You are responsible for any taxes on prizes you receive.
        </p>
        <h3 className="text-lg font-semibold text-brand-blue-dark">7.4 Changes and cancellation of competitions</h3>
        <p>
          We may reschedule, modify, or cancel a competition or event — for example, due to low
          enrollment, venue issues, weather, safety, or circumstances beyond our control. If we cancel
          an event, your options for registration fees are described in Section 9.
        </p>

        {/* 8. Events */}
        <h2 id="events" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          8. In-Person Events &amp; Safety
        </h2>
        <p>
          In-person events may require additional participation agreements, codes of conduct, and
          parental or guardian consent forms, which are part of these Terms for those events. To keep
          participants safe, we may collect medical, allergy, and dietary information as described in
          our{' '}
          <Link href="/privacy" className="text-brand-blue hover:underline">
            Privacy Policy
          </Link>
          ; please provide accurate information and update us if it changes.
        </p>
        <p>
          Participation in physical activities and travel involves inherent risks. You (and, for a
          minor, the parent or guardian) are responsible for assessing whether participation is
          appropriate, for any travel and supervision arrangements not expressly provided by Stellr,
          and for complying with venue and host rules. We may remove any participant whose conduct is
          unsafe, disruptive, or in breach of these Terms or an event code of conduct. Nothing in
          these Terms limits any rights or protections that cannot be waived under applicable law.
        </p>

        {/* 9. Refunds */}
        <h2 id="refunds" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          9. Refunds &amp; Cancellations
        </h2>
        <p>The following applies unless a specific competition, event, or membership states otherwise:</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse border border-gray-200">
            <thead>
              <tr className="bg-gray-50">
                <th className="border border-gray-200 px-4 py-2 text-left font-semibold">What you paid for</th>
                <th className="border border-gray-200 px-4 py-2 text-left font-semibold">Our policy</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Membership fees', 'You can cancel anytime to stop future renewals. Fees already paid are non-refundable except where required by law.'],
                ['Competition / event fees', 'We endeavor to offer refunds or credits where possible. Individual events have differing deadlines and policies — contact the Event Manager for the specific policy and deadlines that apply to your event.'],
                ['Competition / campaign fees', 'Non-refundable, except at our discretion or where required by law.'],
                ['If Stellr cancels a competition', 'We will offer either a full credit toward a future competition, or as much of a partial refund as we can.'],
                ['Donations', 'Donations are non-refundable, except at our discretion or where required by law. See Section 15.'],
              ].map(([item, policy]) => (
                <tr key={item} className="even:bg-gray-50">
                  <td className="border border-gray-200 px-4 py-2 align-top">{item}</td>
                  <td className="border border-gray-200 px-4 py-2 align-top">{policy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>Approved refunds are issued to the original payment method through our payment processor.</p>

        {/* 10. Acceptable Use */}
        <h2 id="acceptable" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          10. Acceptable Use &amp; Community Conduct
        </h2>
        <p>
          Our community is built for students, educators, and mentors. When using the Services, you
          agree that you will not:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>break the law or encourage others to;</li>
          <li>harass, bully, threaten, demean, or impersonate any person, including in community spaces;</li>
          <li>
            post or share content that is hateful, sexually explicit, violent, harmful to minors, or
            otherwise inappropriate for a youth education community;
          </li>
          <li>share another person&rsquo;s private information without permission;</li>
          <li>cheat in competitions, or misrepresent your identity, age, school, or eligibility;</li>
          <li>
            upload malware, attempt to gain unauthorized access, scrape, overload, disrupt, or reverse
            engineer the Services;
          </li>
          <li>infringe anyone&rsquo;s intellectual property or other rights;</li>
          <li>use the Services to send spam or for unauthorized commercial purposes; or</li>
          <li>help anyone else do any of the above.</li>
        </ul>
        <p>
          Some community features are offered through third-party platforms (such as Discord), which
          have their own rules you must also follow. We may moderate, remove content, or suspend
          access to keep the community safe, but we are not obligated to monitor all activity. If you
          see something concerning, please report it to{' '}
          <a href="mailto:hello@stellreducation.org" className="text-brand-blue hover:underline">
            hello@stellreducation.org
          </a>
          .
        </p>

        {/* 11. Your Content */}
        <h2 id="usercontent" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          11. Your Content &amp; Competition Submissions
        </h2>
        <h3 className="text-lg font-semibold text-brand-blue-dark">11.1 You keep ownership</h3>
        <p>
          You (or your school or licensors) keep ownership of the content you submit, post, or upload,
          including competition projects, designs, presentations, profile content, and community posts
          (&ldquo;Your Content&rdquo;).
        </p>
        <h3 className="text-lg font-semibold text-brand-blue-dark">11.2 License you give us</h3>
        <p>
          By submitting Your Content, you grant Stellr a worldwide, non-exclusive, royalty-free,
          sublicensable license to host, store, reproduce, adapt for format, publish, display, and use
          Your Content to operate, promote, and improve the Services and our programs — including in
          competition showcases, marketing, social media, press, and educational materials. For
          minors, the parent, guardian, or authorized school official granting consent agrees to this
          license on the minor&rsquo;s behalf.
        </p>
        <h3 className="text-lg font-semibold text-brand-blue-dark">11.3 Publicity and opt-out</h3>
        <p>
          We will seek consent before publishing identifiable photographs of minors, and you may ask
          us to stop using identifiable submissions or images of a minor, consistent with our{' '}
          <Link href="/privacy" className="text-brand-blue hover:underline">
            Privacy Policy
          </Link>
          . Some uses already published or distributed may not be fully reversible.
        </p>
        <h3 className="text-lg font-semibold text-brand-blue-dark">11.4 Your responsibilities</h3>
        <p>
          You represent that you have the rights to Your Content and that it does not break these Terms
          or any law. We may remove Your Content or decline a submission that we reasonably believe
          violates these Terms, the competition rules, or the rights of others.
        </p>
        <h3 className="text-lg font-semibold text-brand-blue-dark">11.5 Feedback</h3>
        <p>
          If you send us ideas or suggestions about the Services, we may use them without restriction
          or obligation to you.
        </p>

        {/* 12. Our IP */}
        <h2 id="ourip" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          12. Our Intellectual Property
        </h2>
        <p>
          The Services, and all content and materials we provide — including our curriculum,
          competition materials, text, graphics, logos, and software — are owned by Stellr or our
          licensors and are protected by intellectual property laws. The &ldquo;Stellr,&rdquo;
          &ldquo;Stellr Education,&rdquo; and related names and logos are our trademarks; you may not
          use them without our prior written permission.
        </p>
        <p>
          We grant you a limited, non-exclusive, non-transferable, revocable license to access and use
          the Services, and to use curriculum and resources we make available, for personal,
          educational, non-commercial purposes in connection with Stellr programs, unless we expressly
          say otherwise. You may not copy, sell, redistribute, modify, or create derivative works from
          our materials except as allowed by these Terms or with our written permission.
        </p>

        {/* 13. Third-Party */}
        <h2 id="thirdparty" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          13. Third-Party Services &amp; Links
        </h2>
        <p>
          The Services rely on and link to third parties — for example, Stripe (payments), DocuSign
          (parental consent), Discord (community), and our hosting and infrastructure providers — and
          may link to partner, sponsor, university, or host organization websites. Your use of a
          third-party service is governed by that party&rsquo;s own terms and privacy policy. We are
          not responsible for third-party services or websites, and including a link does not mean we
          endorse it.
        </p>

        {/* 14. Privacy */}
        <h2 id="privacy" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          14. Privacy
        </h2>
        <p>
          Your privacy matters to us. Our{' '}
          <Link href="/privacy" className="text-brand-blue hover:underline">
            Privacy Policy
          </Link>{' '}
          explains what personal information we collect, how we use and protect it, and the rights of
          users, parents and guardians (including under COPPA), schools (including under FERPA), and
          California residents. By using the Services, you acknowledge our Privacy Policy.
        </p>

        {/* 15. Donations */}
        <h2 id="donations" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          15. Donations
        </h2>
        <p>
          Donations help fund our educational mission and are processed by our third-party payment
          processor. Unless we say otherwise or the law requires it, donations are non-refundable.
          Information about Stellr&rsquo;s tax status and the deductibility of contributions is
          provided on our{' '}
          <Link href="/donate" className="text-brand-blue hover:underline">
            Donate page
          </Link>
          ; please consult your own tax advisor, as we do not provide tax advice.
        </p>

        {/* 16. Disclaimers */}
        <h2 id="disclaimers" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          16. Disclaimers
        </h2>
        <p>
          The Services are provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. To
          the fullest extent permitted by law, we disclaim all warranties, whether express or implied,
          including implied warranties of merchantability, fitness for a particular purpose, and
          non-infringement. We do not warrant that the Services will be uninterrupted, secure, or
          error-free.
        </p>
        <p>
          Our programs are educational. While we are proud of our participants&rsquo; outcomes, we do
          not guarantee any particular educational result, award, scholarship, admission, or career
          outcome from using the Services or participating in our programs.
        </p>

        {/* 17. Liability */}
        <h2 id="liability" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          17. Limitation of Liability
        </h2>
        <p>
          To the fullest extent permitted by law, Stellr and its officers, directors, employees,
          volunteers, mentors, and agents will not be liable for any indirect, incidental, special,
          consequential, or punitive damages, or for any loss of data, profits, or goodwill, arising
          out of or relating to your use of the Services.
        </p>
        <p>
          To the fullest extent permitted by law, our total liability for all claims relating to the
          Services in any 12-month period is limited to the greater of (a) the total amount you paid to
          Stellr for the Services giving rise to the claim during that period, or (b) US$100.
        </p>
        <p>
          Some jurisdictions do not allow certain limitations, so some of the above may not apply to
          you. <strong>Nothing in these Terms limits or excludes liability that cannot be limited or
          excluded under applicable law</strong> — including, where applicable, liability for death or
          personal injury caused by our negligence, for fraud, or for any non-waivable rights of
          consumers or minors.
        </p>

        {/* 18. Indemnification */}
        <h2 id="indemnity" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          18. Indemnification
        </h2>
        <p>
          To the extent permitted by law, you agree to indemnify and hold harmless Stellr and its
          officers, directors, employees, volunteers, and agents from claims, damages, and reasonable
          costs (including attorneys&rsquo; fees) arising out of your misuse of the Services, your
          violation of these Terms, or your infringement of someone else&rsquo;s rights. If you
          accepted these Terms on behalf of a minor, this applies to the minor&rsquo;s use as well.
          This section does not require you to cover losses caused by our own negligence or misconduct.
        </p>

        {/* 19. Termination */}
        <h2 id="termination" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          19. Suspension &amp; Termination
        </h2>
        <p>
          You may stop using the Services at any time and may close your account by contacting us. We
          may suspend or terminate your access to all or part of the Services if you breach these
          Terms, if needed to protect the safety of participants or the integrity of a competition, or
          if required by law. We will use reasonable efforts to give notice where appropriate.
        </p>
        <p>
          If your access ends, the parts of these Terms that should reasonably continue — such as
          content licenses already granted, intellectual property, disclaimers, limitation of
          liability, indemnification, and dispute resolution — will survive.
        </p>

        {/* 20. Changes */}
        <h2 id="changes" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          20. Changes to the Services and These Terms
        </h2>
        <p>
          We may update these Terms from time to time. When we do, we will post the revised version
          with a new &ldquo;Last Updated&rdquo; date, and for material changes we will provide
          additional notice (for example, by email or a notice in the Services). Changes take effect
          when posted unless we say otherwise. If you continue to use the Services after changes take
          effect, you accept the revised Terms. If you do not agree, please stop using the Services.
        </p>

        {/* 21. Disputes */}
        <h2 id="disputes" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          21. Dispute Resolution &amp; Governing Law
        </h2>
        <p>
          <strong>Let&rsquo;s talk first.</strong> If you have a concern, please contact us at{' '}
          <a href="mailto:hello@stellreducation.org" className="text-brand-blue hover:underline">
            hello@stellreducation.org
          </a>{' '}
          so we can try to resolve it. You agree to give us at least 30 days to work things out
          informally before starting a formal proceeding.
        </p>
        <p>
          These Terms and any dispute relating to them or the Services are governed by the laws of the
          State of Utah, without regard to its conflict-of-laws rules. You and Stellr agree that the
          state and federal courts located in Salt Lake County, Utah have exclusive jurisdiction, and
          you consent to venue there — except that either party may seek relief in any court of
          competent jurisdiction to protect intellectual property or confidential information. Nothing
          in this section removes any right to bring a claim that, under applicable law, must be heard
          in another forum, or that cannot be waived (including rights of minors and consumers).
        </p>

        {/* 22. General */}
        <h2 id="general" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          22. General Terms
        </h2>
        <p>
          <strong>Entire agreement.</strong> These Terms, together with the Privacy Policy and any
          additional terms referenced here, are the entire agreement between you and Stellr about the
          Services.
        </p>
        <p>
          <strong>Severability.</strong> If any part of these Terms is found unenforceable, the rest
          stays in effect.
        </p>
        <p>
          <strong>No waiver.</strong> If we don&rsquo;t enforce a part of these Terms, that isn&rsquo;t
          a waiver of our right to do so later.
        </p>
        <p>
          <strong>Assignment.</strong> You may not transfer your rights or obligations under these
          Terms without our consent. We may assign these Terms in connection with a merger,
          acquisition, or transfer of our assets, consistent with our Privacy Policy.
        </p>
        <p>
          <strong>Force majeure.</strong> We are not responsible for delays or failures caused by
          events beyond our reasonable control.
        </p>
        <p>
          <strong>Electronic communications.</strong> By using the Services, you agree that we may
          communicate with you electronically, and that electronic agreements, notices, and records
          satisfy any legal requirement that they be in writing.
        </p>
        <p>
          <strong>Notices.</strong> We may provide notices to you by email or through the Services. You
          may send notices to us at the contact details below.
        </p>

        {/* 23. Contact */}
        <h2 id="contact" className="text-xl font-bold text-brand-blue-dark scroll-mt-24">
          23. Contact Us
        </h2>
        <p>Questions about these Terms? We&rsquo;re happy to help.</p>
        <p>
          <strong>Stellr</strong> (doing business as Stellr Education)
          <br />
          7533 S Center View Ct, Ste R, West Jordan, UT 84084
          <br />
          Email:{' '}
          <a href="mailto:hello@stellreducation.org" className="text-brand-blue hover:underline">
            hello@stellreducation.org
          </a>
          <br />
          Privacy matters:{' '}
          <a href="mailto:privacy@stellreducation.org" className="text-brand-blue hover:underline">
            privacy@stellreducation.org
          </a>
        </p>
      </div>
    </div>
  )
}
