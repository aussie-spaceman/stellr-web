// Which LOADSCOPED_MODE applies (lib/tenancy/load-scoped.ts says what each one does). Apart
// from load-scoped.ts so lib/authz can read it without the table registry, which names the
// social tables a tenant host may not reach (test/tenant-surface.test.ts).

export const LOADSCOPED_MODES = ['off', 'shadow', 'enforce'] as const
export type LoadScopedMode = (typeof LOADSCOPED_MODES)[number]

/** The environment variable that selects the mode. */
export const LOADSCOPED_MODE_ENV = 'LOADSCOPED_MODE'

/** The configured mode. Unset, empty or unrecognised means off. */
export function loadScopedMode(env: Record<string, string | undefined> = process.env): LoadScopedMode {
  const raw = (env[LOADSCOPED_MODE_ENV] ?? '').trim().toLowerCase()
  return (LOADSCOPED_MODES as readonly string[]).includes(raw) ? (raw as LoadScopedMode) : 'off'
}

const warnedModes = new Set<string>()

/** A set-but-unrecognised LOADSCOPED_MODE means off: say so once per instance. */
export async function reportUnrecognisedMode(): Promise<void> {
  const raw = (process.env[LOADSCOPED_MODE_ENV] ?? '').trim().toLowerCase()
  if (raw === '' || (LOADSCOPED_MODES as readonly string[]).includes(raw) || warnedModes.has(raw)) return
  warnedModes.add(raw)
  const message = `${LOADSCOPED_MODE_ENV} is set to an unrecognised value and was treated as off`
  console.error(`[load-scoped] ${message}`)
  try {
    const { captureRequestError } = await import('@/lib/app-errors')
    await captureRequestError(new Error(message), { method: 'LOADSCOPED', path: LOADSCOPED_MODE_ENV }, { routePath: LOADSCOPED_MODE_ENV })
  } catch (e) {
    console.error('[load-scoped] mode report failed:', e instanceof Error ? e.message : e)
  }
}
