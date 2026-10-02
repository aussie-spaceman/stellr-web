// Signing-engine selection. Call sites depend on the EsignProvider interface
// and on the helpers in ./issue and ./operations, never on a vendor module:
// lib/esign/seam.test.ts fails the build if one creeps back in.

import type { EsignProvider, ProviderId } from '@/lib/esign/types'
import { docusignProvider } from '@/lib/esign/providers/docusign'

export * from '@/lib/esign/types'

const PROVIDERS: Partial<Record<ProviderId, EsignProvider>> = {
  docusign: docusignProvider,
}

/** Whether an engine is built and registered in this deployment. */
export function hasProvider(id: ProviderId): boolean {
  return PROVIDERS[id] !== undefined
}

export function getProvider(id: ProviderId): EsignProvider {
  const provider = PROVIDERS[id]
  if (!provider) throw new Error(`E-signature provider "${id}" is not available`)
  return provider
}

/**
 * The engine that issued a stored agreement. Rows written before the provider
 * column existed carry no value and are DocuSign's.
 */
export function providerForRow(row: { provider?: string | null }): EsignProvider {
  return getProvider((row.provider ?? 'docusign') as ProviderId)
}
