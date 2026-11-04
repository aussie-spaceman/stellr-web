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
vi.mock('next/headers', async () => (await import('./harness')).nextHeadersMock())
vi.mock('next/cache', async (importOriginal) =>
  (await import('./harness')).nextCacheMock(await importOriginal<Record<string, unknown>>()),
)
vi.mock('next/server', async (importOriginal) =>
  (await import('./harness')).nextServerMock(await importOriginal<Record<string, unknown>>()),
)
