import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { vercelTarget } from '@/lib/env'
import { integrationEnvironments, isRealProductionApp } from '@/lib/env-guards'
import { supabaseKeySlots } from '@/lib/supabase-keys'
import { tenantRoutingConfig } from '@/lib/tenancy/host'

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
//
// `supabaseKeys` (S0, Nov 2026) says which Supabase key format each slot holds
// ('publishable' | 'secret' | 'legacy-jwt' | …), the role it acts as ('anon' |
// 'service_role') and which variable it came from: the check before the legacy
// keys are disabled (docs/RUNBOOK-supabase-api-keys.md). Informational: it does
// not feed `ok`.
//
// `tenantRouting` (S5, B5) says whether the flag is on and why the tenant zone
// setting is unusable, if it is. Read it before attaching a tenant zone: with a bad
// zone setting, hosts in that zone cannot be told from Stellr's. Never the zone
// itself. Informational too: it does not feed `ok`.
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

  const routing = tenantRoutingConfig()

  return NextResponse.json({
    deployment,
    environments,
    supabaseKeys: supabaseKeySlots(),
    tenantRouting: { enabled: routing.enabled, suffixError: routing.suffixError },
    problems,
    ok: problems.length === 0,
  })
}
