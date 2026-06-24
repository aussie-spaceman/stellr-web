import { notFound } from 'next/navigation'
import { loadSpaceAdmin } from '@/lib/space-admin'
import { resolveTierMap } from '@/lib/tiers-server'
import { SpaceConfig } from '@/components/admin/community/spaces/SpaceConfig'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const config = await loadSpaceAdmin(id)
  return { title: `Admin — ${config?.space.name ?? 'Space'}` }
}

export default async function AdminSpaceConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [config, tierMap] = await Promise.all([loadSpaceAdmin(id), resolveTierMap()])
  if (!config) notFound()

  return <SpaceConfig config={config} tierIdByName={tierMap.idByName} />
}
