import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { vercelTarget } from '@/lib/env'
import { integrationEnvironments, isRealProductionApp } from '@/lib/env-guards'
import { supabaseServer } from '@/lib/supabase'
import { supabaseKeySlots } from '@/lib/supabase-keys'
import { resolveDerivationMode, tenancyReport, type DerivationModeReport } from '@/lib/tenancy/flags'
import { tenantRoutingConfig } from '@/lib/tenancy/host'
import { loadScopedMode } from '@/lib/tenancy/load-scoped'
import { isTenantDbEnabled } from '@/lib/tenancy/tenant-db-config'

/** The derivation-mode read gives up after this, and reports 'unavailable'. */
const DERIVATION_READ_TIMEOUT_MS = 2_000

/**
 * tenancy_settings.derivation_mode: one service-role read of the singleton row
 * (owner yes, wave 7 W7-8). Never throws; any failure is 'unavailable'.
 */
async function readDerivationMode(): Promise<DerivationModeReport> {
  try {
    const { data, error } = await supabaseServer()
      .from('tenancy_settings')
      .select('derivation_mode')
      .eq('id', true)
      .abortSignal(AbortSignal.timeout(DERIVATION_READ_TIMEOUT_MS))
      .maybeSingle()
    return resolveDerivationMode({ failed: !!error, value: (data as { derivation_mode?: unknown } | null)?.derivation_mode })
  } catch {
    return resolveDerivationMode({ failed: true, value: undefined })
  }
}

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
//
// `loadScopedMode` (S5, C16) is the mode converted routes are in: an unrecognised value
// reads as off, so this is how to see what a flip really did. Informational.
//
// `tenancy` (S5 wave 7, O1) is every S5 switch as it RESOLVED, from the registry in
// lib/tenancy/flags.ts: modes, booleans, counts and fixed labels, never a raw
// value, secret, URL or zone. `unrecognised` names the variables whose value fell
// back to the default; `invalidCombinations` lists switches set without what they
// need. The derivation mode costs one service-role read. Informational: it does not
// feed `ok`. Each dev flip checks it after the redeploy (docs/TENANCY-S5.md).
//
// `tenancy.tenantDb.config` (S5 wave 7, O3) appears only when TENANT_DB_ENABLED is
// 'true': whether TENANT_DATABASE_URL and its CA pass the driver's checks, each 'ok'
// or a fixed reason, never a value. The driver module is loaded for it by dynamic
// import, so with the flag off nothing more is imported and the response is unchanged.
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
  const report = tenancyReport(await readDerivationMode())
  const tenancy = isTenantDbEnabled()
    ? { ...report, tenantDb: { ...report.tenantDb, config: (await import('@/lib/tenancy/driver')).tenantDbConfigStatus() } }
    : report

  return NextResponse.json({
    deployment,
    environments,
    supabaseKeys: supabaseKeySlots(),
    tenantRouting: { enabled: routing.enabled, suffixError: routing.suffixError },
    loadScopedMode: loadScopedMode(),
    tenancy,
    problems,
    ok: problems.length === 0,
  })
}
