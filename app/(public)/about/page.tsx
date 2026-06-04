import type { Metadata } from 'next'
import Image from 'next/image'
import { Linkedin } from 'lucide-react'
import { getTeamMembers, urlFor } from '@/lib/sanity'

export const metadata: Metadata = {
  title: 'About Stellr',
  description: 'We connect students to the future they\'re studying for.',
}

export const revalidate = 3600

interface TeamMember {
  _id: string
  name: string
  role: string
  bio?: string
  photo?: { asset: { _ref: string } }
  linkedIn?: string
}

export default async function AboutPage() {
  const teamData = await getTeamMembers().catch(() => null)
  const team: TeamMember[] = teamData ?? []

  return (
    <>
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto max-w-3xl">
          <h1 className="text-4xl sm:text-5xl font-bold mb-4">
            We connect students to the future they&apos;re studying for.
          </h1>
        </div>
      </section>

      {/* ── Who We Are ───────────────────────────────────────────────── */}
      <section className="section-padding">
        <div className="container-max max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">Who We Are</p>
          <div className="space-y-4 text-brand-grey-dark text-lg leading-relaxed">
            <p>
              Stellr runs real-world industry simulation competitions for middle and high school students across the US. We believe students need to experience industry long before they get there — so we build environments where they can.
            </p>
            <p>
              Our competitions bring together students, educators, and industry professionals in a single room, working on challenges that mirror the complexity of real professional problems. No textbook solutions. No single right answer.
            </p>
            <p>
              The result is an experience that changes how students see themselves — and how they see their future.
            </p>
          </div>
        </div>
      </section>

      {/* ── Why We Do It ─────────────────────────────────────────────── */}
      <section className="section-padding bg-brand-grey-light">
        <div className="container-max max-w-4xl">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">Our Mission</p>
          <blockquote className="text-2xl sm:text-3xl font-bold text-brand-blue-dark leading-snug">
            &ldquo;We connect student aspirations for the future to their studies today.&rdquo;
          </blockquote>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { stat: '90%+', label: 'of participants go on to study STEM at college' },
              { stat: '3', label: 'confirmed events across the US in 2026–27' },
              { stat: '100%', label: 'industry-simulated, real-world challenges' },
            ].map((item) => (
              <div key={item.stat} className="text-center p-6 bg-white rounded-xl shadow-sm">
                <p className="text-4xl font-bold text-brand-blue">{item.stat}</p>
                <p className="mt-2 text-sm text-brand-grey-dark">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Team ─────────────────────────────────────────────────────── */}
      <section id="team" className="section-padding scroll-mt-20">
        <div className="container-max">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-blue mb-3">Our Team</p>
          <h2 className="text-3xl font-bold text-brand-blue-dark mb-10">The people behind Stellr</h2>

          {team.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
              {team.map((member) => (
                <div key={member._id} className="text-center">
                  {/* Photo */}
                  <div className="relative w-32 h-32 mx-auto rounded-full overflow-hidden bg-brand-grey-light mb-4">
                    {member.photo ? (
                      <Image
                        src={urlFor(member.photo).width(256).height(256).url()}
                        alt={member.name}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-3xl font-bold text-brand-grey-mid">
                        {member.name.charAt(0)}
                      </div>
                    )}
                  </div>
                  <h3 className="font-bold text-brand-blue-dark">{member.name}</h3>
                  <p className="text-sm text-brand-grey-mid mt-0.5">{member.role}</p>
                  {member.bio && (
                    <p className="text-sm text-brand-grey-dark mt-2 line-clamp-3">{member.bio}</p>
                  )}
                  {member.linkedIn && (
                    <a
                      href={member.linkedIn}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${member.name} on LinkedIn`}
                      className="inline-flex items-center gap-1 mt-3 text-brand-blue hover:text-blue-700 transition-colors text-sm"
                    >
                      <Linkedin size={16} /> LinkedIn
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            /* Placeholder until team members are added in Sanity */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {['Founder & CEO', 'Head of Events', 'Head of Partnerships'].map((role) => (
                <div key={role} className="text-center">
                  <div className="w-32 h-32 mx-auto rounded-full bg-brand-grey-light flex items-center justify-center mb-4">
                    <span className="text-brand-grey-mid text-sm">Photo</span>
                  </div>
                  <h3 className="font-bold text-brand-blue-dark">Team Member</h3>
                  <p className="text-sm text-brand-grey-mid mt-0.5">{role}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Supporters / Partners ────────────────────────────────────── */}
      <section className="section-padding bg-brand-grey-light">
        <div className="container-max text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-grey-mid mb-8">
            Supporters &amp; Partners
          </p>
          <div className="flex flex-wrap justify-center items-center gap-12 opacity-50">
            {/* Placeholder logos — replace with real partner logos in Sanity */}
            {['Partner 1', 'Partner 2', 'Partner 3', 'Partner 4'].map((p) => (
              <div key={p} className="w-32 h-12 bg-gray-300 rounded flex items-center justify-center text-xs text-gray-500">
                {p}
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-brand-grey-mid italic">Partner logos coming soon.</p>
        </div>
      </section>
    </>
  )
}
