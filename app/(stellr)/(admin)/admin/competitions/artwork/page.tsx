import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireEventAccess } from '@/lib/event-access'
import { ARTWORK_THEMES, ARTWORK_THEME_LABEL, isArtworkTheme } from '@/lib/artwork-theme'
import EventBadges from '@/components/admin/EventBadges'
import EventCertificates from '@/components/admin/EventCertificates'
import PdCertificateArtwork from '@/components/admin/PdCertificateArtwork'

export const metadata = { title: 'Admin — Default artwork' }
export const dynamic = 'force-dynamic'

// The artwork every event falls back to, per competition theme (30 Oct 2026):
// name badges, the six event certificates and the educator PD certificate.
// An event's own upload on its Settings tab overrides any of them. Admins only:
// a change here reaches every event of the theme. lib/artwork-defaults.ts.
export default async function ArtworkDefaultsPage({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  const access = await requireEventAccess()
  if (!access.ok) redirect(access.status === 401 ? '/sign-in' : '/admin')
  if (!access.isAdmin) redirect('/admin/competitions')

  const requested = (await searchParams).theme
  const theme = isArtworkTheme(requested) ? requested : 'space'
  const label = ARTWORK_THEME_LABEL[theme]

  return (
    <div className="max-w-content space-y-6">
      <div>
        <Link href="/admin/competitions" className="text-sm text-primary">
          ← Competitions
        </Link>
        <h1 className="mt-1 font-heading text-ds-h2 text-ink">Default artwork</h1>
        <p className="mt-2 text-content-body">
          What every event prints until it uploads its own. Each event can replace any badge, certificate or PD page
          on its Settings tab, and go back to the default at any time.
        </p>
      </div>

      <nav aria-label="Competition theme" className="inline-flex rounded-control border border-line p-0.5">
        {ARTWORK_THEMES.map((t) => (
          <Link
            key={t}
            href={`/admin/competitions/artwork?theme=${t}`}
            aria-current={t === theme ? 'page' : undefined}
            className={`rounded-control px-4 py-2 text-sm font-medium ${
              t === theme ? 'bg-primary text-white' : 'text-ink hover:bg-surface'
            }`}
          >
            {ARTWORK_THEME_LABEL[t]} events
          </Link>
        ))}
      </nav>

      <EventBadges key={`badges-${theme}`} theme={theme} />

      <EventCertificates key={`certificates-${theme}`} theme={theme} />

      <section className="rounded-ds-card border border-line bg-white p-4">
        <h3 className="text-sm font-semibold text-content-muted">Educator PD certificate</h3>
        <p className="mt-1 text-xs text-content-muted">
          Issued from the Educator PD panel on a {label} event&rsquo;s Settings tab.
        </p>
        <div className="mt-3">
          <PdCertificateArtwork key={`pd-${theme}`} theme={theme} />
        </div>
      </section>
    </div>
  )
}
