// Module-boundary mocks for the IDOR suites. Import this FIRST in a test file,
// before anything that loads a route handler. See test/idor/harness.ts.
import { vi } from 'vitest'

vi.mock('@clerk/nextjs/server', async (importOriginal) =>
  (await import('./harness')).clerkServerMock(await importOriginal<Record<string, unknown>>()),
)
vi.mock('@supabase/supabase-js', async (importOriginal) =>
  (await import('./harness')).supabaseJsMock(await importOriginal<Record<string, unknown>>()),
)
vi.mock('stripe', async () => (await import('./harness')).stripeMock())
// The routing lane replaces this stub with the host's tenant; here it follows the case's host.
vi.mock('@/lib/authz/tenant', async () => {
  const { harness } = await import('./harness')
  return { currentTenantId: () => harness.context.callerTenantId }
})
// Audit is on and writes nothing: each event is recorded for the running case.
vi.mock('@/lib/audit/platform', async (importOriginal) =>
  (await import('./harness')).platformAuditMock(await importOriginal<Record<string, unknown>>()),
)
vi.mock('next/headers', async () => (await import('./harness')).nextHeadersMock())
vi.mock('next/cache', async (importOriginal) =>
  (await import('./harness')).nextCacheMock(await importOriginal<Record<string, unknown>>()),
)
vi.mock('next/server', async (importOriginal) =>
  (await import('./harness')).nextServerMock(await importOriginal<Record<string, unknown>>()),
)
