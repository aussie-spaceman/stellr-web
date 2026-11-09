import { notFound } from 'next/navigation'
import { loadSpaceAdmin } from '@/lib/space-admin'
import { resolveTierMap } from '@/lib/tiers-server'
import { SpaceConfig } from '@/components/admin/community/spaces/SpaceConfig'
import { authz } from '@/lib/authz'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const config = await loadSpaceAdmin(id)
  return { title: `Admin — ${config?.space.name ?? 'Space'}` }
}

export default async function AdminSpaceConfigPage({ params }: { params: Promise<{ id: string }> }) {
  await authz.page.requireStellrAdmin({ route: '/admin/community/spaces/[id]' })
  const { id } = await params
  const [config, tierMap] = await Promise.all([loadSpaceAdmin(id), resolveTierMap()])
  if (!config) notFound()

  return <SpaceConfig config={config} tierIdByName={tierMap.idByName} />
}
