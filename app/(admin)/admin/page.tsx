import Link from 'next/link'
import { integrationEnvironments, isProductionDeployment, type IntegrationEnvironment } from '@/lib/env-guards'

export const metadata = { title: 'Admin — Dashboard' }

// Admin landing page. The members list now lives at /admin/members; this will
// grow into an at-a-glance operations dashboard.

const ENV_STYLES: Record<IntegrationEnvironment, { label: string; cls: string }> = {
  production:   { label: 'Live',       cls: 'bg-green-100 text-green-700' },
  sandbox:      { label: 'Sandbox',    cls: 'bg-red-100 text-red-700' },
  unconfigured: { label: 'Not set up', cls: 'bg-brand-hairline text-brand-muted-soft' },
}

const INTEGRATION_LABELS: Record<string, string> = {
  docusign: 'DocuSign (e-signature)',
  stripe:   'Stripe (payments)',
  clerk:    'Clerk (accounts)',
}

// Which environment each integration is actually pointed at. Production issued
// real parental consent forms from the DocuSign DEMO account for three months
// and nothing surfaced it: `vercel env pull` redacts secret values, so this can
// only be answered from inside the deployment. See lib/env-guards.ts.
function IntegrationHealth() {
  const environments = integrationEnvironments()
  const problems = isProductionDeployment()
    ? Object.entries(environments).filter(([, env]) => env !== 'production')
    : []

  return (
    <div className="app-card p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-heading uppercase text-brand-blue-dark">Integration environments</h2>
        <span className="text-xs text-brand-muted-soft">
          Deployment: {process.env.VERCEL_ENV ?? 'development'}
        </span>
      </div>

      {problems.length > 0 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>This is a production deployment using sandbox credentials.</strong> Anything issued
          through {problems.map(([name]) => INTEGRATION_LABELS[name] ?? name).join(', ')} is not real —
          DocuSign sandbox envelopes are stamped &ldquo;Demonstration document only&rdquo; and are not
          binding signatures. Fix the variables in Vercel (Production scope) and redeploy.
        </div>
      )}

      <dl className="mt-4 divide-y divide-brand-hairline text-sm">
        {Object.entries(environments).map(([name, env]) => (
          <div key={name} className="flex items-center justify-between py-2">
            <dt className="text-brand-muted">{INTEGRATION_LABELS[name] ?? name}</dt>
            <dd>
              <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${ENV_STYLES[env].cls}`}>
                {ENV_STYLES[env].label}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-xs text-brand-grey-dark">
        Environment only — never a key, hostname or account id.
      </p>
    </div>
  )
}

export default function AdminDashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow flex items-center gap-2 text-brand-blue">
          <span className="h-2 w-2 rounded-full bg-brand-blue-bright" /> Admin
        </p>
        <h1 className="mt-1 font-heading uppercase text-title text-brand-blue-dark">Dashboard</h1>
      </div>

      <IntegrationHealth />

      <div className="app-card p-6">
        <p className="text-sm text-brand-muted">More dashboard panels coming soon.</p>
        <Link
          href="/home"
          className="mt-4 inline-block rounded-lg bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark"
        >
          Return to web app
        </Link>
      </div>
    </div>
  )
}
