import { resolveTierMap } from '@/lib/tiers-server'
import { LockedSpace } from './LockedSpace'
import type { SpaceDetail } from '@/lib/spaces'

// Server wrapper that resolves tier names for the locked screen (screen 07).
// Pages render this when a member opens a Private space their tier can't enter.
export async function LockedSpaceGate({ space }: { space: SpaceDetail }) {
  const tierMap = await resolveTierMap()
  return (
    <LockedSpace
      name={space.name}
      theme={space.theme}
      description={space.description}
      assignedTierIds={space.assignedTierIds}
      tierNames={tierMap.nameById}
    />
  )
}
