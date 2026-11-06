import { getRegistrationPrefill } from '@/lib/registration-prefill'
import { groupJoinBody } from './join-body'

interface PageProps {
  params: Promise<{ slug: string; token: string }>
}

export default async function GroupJoinPage({ params }: PageProps) {
  const { slug, token } = await params
  return groupJoinBody({ slug, token, loadPrefill: () => getRegistrationPrefill().catch(() => null) })
}
