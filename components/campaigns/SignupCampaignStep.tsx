'use client'

import { useRouter } from 'next/navigation'
import { Orbit, Environment } from '@stellr/icons'
import type { CampaignOption } from '@/lib/campaigns'

// Optional final step of educator signup: offer to register a group for a
// Campaign now. Entry point A — links straight into the group registration flow.
export function SignupCampaignStep({ campaigns }: { campaigns: CampaignOption[] }) {
  const router = useRouter()

  return (
    <div className="flex min-h-screen items-center justify-center bg-midnight px-4 py-10">
      <div className="w-full max-w-[520px] rounded-panel bg-white p-8 shadow-card-lift">
        {/* Progress: first two done (green), third active (amber) */}
        <div className="mb-4 flex gap-1.5">
          <span className="h-1 flex-1 rounded-pill bg-enviro-green" />
          <span className="h-1 flex-1 rounded-pill bg-enviro-green" />
          <span className="h-1 flex-1 rounded-pill bg-pathway-amber" />
        </div>
        <p className="text-ds-meta text-content-muted">Step 3 of 3 · Educator membership created</p>
        <h1 className="mt-2 font-heading text-2xl font-bold text-ink">
          Want to run a Campaign with your students?
        </h1>
        <p className="mt-2 text-sm text-content-secondary">
          You can do this now, or any time from your dashboard. Registering a group is free and lets
          your students submit a proposal by the deadline.
        </p>

        <div className="mt-6 space-y-3">
          {campaigns.map((c) => {
            const ThemeIcon = c.theme === 'enviro' ? Environment : Orbit
            const featured = c.theme === 'space'
            return (
              <button
                key={c.slug}
                type="button"
                onClick={() => router.push(`/register/${c.slug}/group`)}
                className={`flex w-full items-center gap-3 rounded-ds-card border p-4 text-left transition-colors ${
                  featured
                    ? 'border-pathway-amber/40 bg-pathway-amber-bg'
                    : 'border-line bg-white hover:border-primary'
                }`}
              >
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-white ${c.theme === 'enviro' ? 'bg-enviro-green' : 'bg-space-violet'}`}>
                  <ThemeIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-heading font-bold text-ink">{c.title}</p>
                  <p className="text-xs text-content-muted">
                    ✦ {c.themeLabel} Campaign · {c.seasonLabel} · due {c.deadlineLabel}
                  </p>
                </div>
                <span className="text-content-muted">→</span>
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => router.push('/home')}
          className="mt-6 text-sm font-semibold text-content-muted hover:text-content"
        >
          Skip for now — take me to my dashboard →
        </button>
      </div>
    </div>
  )
}
