import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { vercelTarget } from '@/lib/env'
import { integrationEnvironments, isRealProductionApp } from '@/lib/env-guards'

// GET /api/admin/health/integrations
//
// Answers "are we actually live?" in one call. Production ran real parental
// consent forms through the DocuSign DEMO account for three months (June–Sept
// 2026) and the only way to find out was to authenticate against DocuSign by
// hand and read the account plan back. `vercel env pull` redacts secret values,
// so this cannot be checked from outside — it has to be asked of the deployment.
//
// Returns the ENVIRONMENT of each integration ('production' | 'sandbox' |
// 'unconfigured'), never a key, a hostname or an account id.
export async function GET() {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const environments = integrationEnvironments()
  const deployment = vercelTarget()
  // The REAL production app, not merely a Vercel production target — the dev
  // project builds `dev` as its own production and is meant to be on sandboxes.
  // `problems` must list what would actually be refused, or it cries wolf on
  // every dev deployment and nobody reads it.
  const production = isRealProductionApp()

  // On the real production app, anything still on sandbox credentials is a
  // defect, not a configuration choice.
  const problems = production
    ? Object.entries(environments)
        .filter(([, env]) => env !== 'production')
        .map(([name, env]) => ({ integration: name, environment: env }))
    : []

  return NextResponse.json({
    deployment,
    environments,
    problems,
    ok: problems.length === 0,
  })
}
